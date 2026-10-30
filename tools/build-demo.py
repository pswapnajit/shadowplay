#!/usr/bin/env python3
"""Cuts the demo video from the recordings in tools/out/rec into acts.

Each act is one or more recordings (the story's segments S1..Sn, made by
tools/record-story.mjs, or a clip made by tools/record-clip.mjs), cut down to
the ranges in its "keep" list, with captions at story moments, the Lantern's
lines subtitled, and (for the two-player clip) the friend's screen inset.
The game's own sound is used as recorded: it includes the Lantern's voice
(OpenAI text to speech, played in the page), so nothing is dubbed.

Usage: python3 tools/build-demo.py [out.mp4]
Config: tools/demo-video.json
  {"acts": [{"segments": ["S1", "S2"], "keep": [[t0, t1], ...], "title": true,
             "guest": "D1-guest", "guestLabel": "...",
             "captions": [{"at": "ask1", "offset": 0.3, "text": "...", "dur": 5}]}],
   "end": {"title": "...", "lines": ["..."], "link": "...", "credit": "..."}}
  Times in "keep" are seconds into the act's recordings, joined end to end.
  Caption anchors: start, seek, story, ask<N>, cue:<name>, end, free.
"""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("bsv", os.path.join(ROOT, "build-story-video.py"))
bsv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bsv)
run, card, keep_ranges, W, H, FONT, FONT_I, FF = bsv.run, bsv.card, bsv.keep_ranges, bsv.W, bsv.H, bsv.FONT, bsv.FONT_I, bsv.FF

REC = os.path.join(ROOT, "out", "rec")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "out", "shadowplay-demo-v2.mp4")
CFG = json.load(open(os.path.join(ROOT, "demo-video.json")))
CREAM = (255, 241, 214, 255)
PIP_W, PIP_H = 448, 252
PIP_X, PIP_Y = W - PIP_W - 28, 150


def clip(name, tmp, crop, audio=True):
    """One recording, live part only, as a 30 fps 720p clip (with its sound, or silence)."""
    meta = json.load(open(os.path.join(REC, name, "frames.json")))
    t0, t1 = meta["liveT0"], meta["liveT1"]
    frames = [f for f in meta["frames"] if t0 - 0.05 <= f["ts"] <= t1]
    lst = os.path.join(tmp, f"{name}.txt")
    with open(lst, "w") as f:
        for i, fr in enumerate(frames):
            dur = (frames[i + 1]["ts"] - fr["ts"]) if i + 1 < len(frames) else 1 / 30
            f.write(f"file '{os.path.join(REC, name, 'frames', fr['file'])}'\nduration {max(dur, 0.001):.5f}\n")
        f.write(f"file '{os.path.join(REC, name, 'frames', frames[-1]['file'])}'\n")
    length = t1 - t0
    out = os.path.join(tmp, f"{name}.mp4")
    sound = (
        ["-ss", f"{max(0.0, t0 - meta['audioT0']):.3f}", "-i", os.path.join(REC, name, "audio.webm")]
        if audio
        else ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    )
    run([
        "-f", "concat", "-safe", "0", "-i", lst,
        *sound,
        "-vf", f"fps=30,crop={crop},scale=1280:720:flags=lanczos,unsharp=5:5:0.6,eq=contrast=1.12:saturation=1.08:gamma=0.97,format=yuv420p",
        "-af", "aresample=48000,apad",
        "-t", f"{length:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "17",
        "-c:a", "aac", "-b:a", "192k",
        out,
    ])
    story_path = os.path.join(REC, name, "story.json")
    story = json.load(open(story_path)) if os.path.exists(story_path) else []
    return out, length, story


def joined(names, tmp, crop, audio=True, tag="act"):
    """Several recordings end to end (they were recorded frozen in between, so they join seamlessly)."""
    parts, events, offset = [], [], 0.0
    for n in names:
        c, length, story = clip(n, tmp, crop, audio)
        parts.append(c)
        events += [{**e, "t": e["t"] + offset} for e in story]
        offset += length
    if len(parts) == 1:
        return parts[0], offset, events
    out = os.path.join(tmp, f"{tag}-joined.mp4")
    with open(os.path.join(tmp, f"{tag}-join.txt"), "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    run(["-f", "concat", "-safe", "0", "-i", os.path.join(tmp, f"{tag}-join.txt"), "-c", "copy", out])
    return out, offset, events


def label(text, tmp, name):
    """A small caption for the inset."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT_I, 22)
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    x = PIP_X + (PIP_W - (r - l)) // 2
    y = PIP_Y - 40
    d.rounded_rectangle((x - 12, y + t - 7, x + (r - l) + 12, y + b + 7), radius=10, fill=(20, 13, 8, 190))
    d.text((x - l, y), text, font=f, fill=CREAM)
    d.rounded_rectangle((PIP_X - 3, PIP_Y - 3, PIP_X + PIP_W + 3, PIP_Y + PIP_H + 3), radius=8, outline=(243, 201, 122, 230), width=3)
    p = os.path.join(tmp, f"{name}.png")
    img.save(p)
    return p


def build_act(i, a, tmp):
    main, total, events = joined(a["segments"], tmp, "756:425:0:10", True, f"a{i}")
    keep = [tuple(k) for k in a.get("keep", [[0, total]])]
    keep = [(max(0.0, s), min(total, e)) for s, e in keep if e > s]

    def mapped(t):
        acc = 0.0
        for s, e in keep:
            if s <= t <= e:
                return acc + (t - s)
            acc += e - s
        return None

    final = sum(e - s for s, e in keep)

    anchors = {"start": 0.0}
    asks = [e for e in events if e.get("story") == "asking"]
    for k, e in enumerate(asks, 1):
        anchors[f"ask{k}"] = e["t"]
    for e in events:
        if "cue" in e:
            anchors.setdefault(f"cue:{e['cue']}", e["t"])
        if e.get("phase") == "seek":
            anchors.setdefault("seek", e["t"])
        if e.get("phase") == "story":
            anchors.setdefault("story", e["t"])
        if e.get("story") == "ending":
            anchors.setdefault("end", e["t"])
        if e.get("phase") == "free":
            anchors.setdefault("free", e["t"])

    overlays = []
    if a.get("title"):
        overlays.append((card([("Shadowplay", FONT_I, 92, CREAM, 40, False),
                               ("a hand-shadow theatre with a storyteller, for Meta Quest", FONT, 28, (255, 231, 194, 255), 150, False)], f"a{i}title", tmp), 0.4, 5.4))
    for k, c in enumerate(a.get("captions", [])):
        at = anchors.get(c["at"])
        s0 = mapped(at + c.get("offset", 0.0)) if at is not None else None
        if s0 is None:
            print(f"  (act {i}: caption at {c['at']} falls in a cut; skipped)")
            continue
        overlays.append((card([(c["text"], FONT, 27, (255, 244, 226, 255), 34, True)], f"a{i}cap{k}", tmp), s0, min(final, s0 + c.get("dur", 4.5))))
    says = [e for e in events if "say" in e]
    if a.get("subtitles", True):
        for k, s in enumerate(says):
            s0 = mapped(s["t"])
            if s0 is None:
                continue
            nxt = says[k + 1]["t"] if k + 1 < len(says) else s["t"] + 8
            s1 = mapped(min(nxt, s["t"] + 9.5))
            if s1 is None:
                # the next line was cut: keep this one up until its piece ends
                s1 = next((mapped(e) for b, e in keep if b <= s["t"] <= e), None) or s0 + 5
            overlays.append((card([(s["say"], FONT_I, 30, CREAM, H - 70, True)], f"a{i}say{k}", tmp), s0 + 0.15, max(s0 + 1.5, s1 - 0.15)))

    inputs = ["-i", main]
    chain, parts = [], []
    guest = a.get("guest")
    if guest:
        gclip, _, _ = joined([guest], tmp, "756:425:0:0", False, f"a{i}g")
        inputs += ["-i", gclip]
    for k, (s, e) in enumerate(keep):
        chain.append(f"[0:v]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS[v{k}]")
        chain.append(f"[0:a]atrim=start={s:.3f}:end={e:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.06,afade=t=out:st={max(0, e - s - 0.06):.3f}:d=0.06[a{k}]")
        if guest:
            chain.append(f"[1:v]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS[g{k}]")
        parts.append(f"[v{k}][a{k}]")
    chain.append(f"{''.join(parts)}concat=n={len(keep)}:v=1:a=1[base][au]")
    cur = "base"
    first_overlay_input = 1
    if guest:
        chain.append(f"{''.join(f'[g{k}]' for k in range(len(keep)))}concat=n={len(keep)}:v=1:a=0[gcat]")
        chain.append(f"[gcat]scale={PIP_W}:{PIP_H}:flags=lanczos[pip]")
        chain.append(f"[{cur}][pip]overlay={PIP_X}:{PIP_Y}[withpip]")
        cur = "withpip"
        first_overlay_input = 2
        overlays.insert(0, (label(a.get("guestLabel", "Your friend's screen, far away"), tmp, f"a{i}label"), 0.0, final))
    for k, (png, s0, e0) in enumerate(overlays):
        dur = max(0.5, e0 - s0)
        fd = 0.3
        inputs += ["-loop", "1", "-framerate", "30", "-t", f"{dur:.3f}", "-i", png]
        n = first_overlay_input + k
        chain.append(f"[{n}:v]format=rgba,fade=t=in:st=0:d={fd}:alpha=1,fade=t=out:st={max(0, dur - fd):.3f}:d={fd}:alpha=1,setpts=PTS+{s0:.3f}/TB[o{k}]")
        chain.append(f"[{cur}][o{k}]overlay=0:0:eof_action=pass[x{k}]")
        cur = f"x{k}"
    chain.append(f"[{cur}]fade=t=in:st=0:d=0.45,fade=t=out:st={final - 0.45:.2f}:d=0.45,format=yuv420p[vo]")
    chain.append(f"[au]afade=t=in:st=0:d=0.4,afade=t=out:st={final - 0.45:.2f}:d=0.45[ao]")
    script = os.path.join(tmp, f"a{i}.graph")
    open(script, "w").write(";\n".join(chain))
    out = os.path.join(tmp, f"act{i}.mp4")
    run([*inputs, "-/filter_complex", script, "-map", "[vo]", "-map", "[ao]", "-t", f"{final:.3f}",
         "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-r", "30", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", out])
    print(f"act {i}: {final:.1f}s from {total:.1f}s recorded ({len(keep)} pieces)")
    return out, final


def build_end(last, tmp, cfg):
    """The end card: the last moment of the last act, dimmed, with the title, the link and the credits."""
    still = os.path.join(tmp, "last.png")
    run(["-sseof", "-0.6", "-i", last, "-frames:v", "1", still])
    over = card([(cfg["title"], FONT_I, 80, CREAM, 150, False)]
                + [(t, FONT, 30, (255, 231, 194, 255), 262 + 46 * k, False) for k, t in enumerate(cfg["lines"])]
                + [(cfg["link"], FONT, 30, (243, 201, 122, 255), 262 + 46 * len(cfg["lines"]) + 26, True),
                   (cfg["credit"], FONT, 17, (255, 241, 214, 200), H - 52, False)], "endcard", tmp, backdrop=200)
    dur = cfg.get("seconds", 6.0)
    out = os.path.join(tmp, "end.mp4")
    run(["-loop", "1", "-framerate", "30", "-t", f"{dur}", "-i", still,
         "-loop", "1", "-framerate", "30", "-t", f"{dur}", "-i", over,
         "-f", "lavfi", "-t", f"{dur}", "-i", "anullsrc=r=48000:cl=stereo",
         "-filter_complex", f"[1:v]format=rgba,fade=t=in:st=0:d=0.8:alpha=1[o];[0:v][o]overlay=0:0,fade=t=out:st={dur - 1.2}:d=1.2,format=yuv420p[v]",
         "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-r", "30", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", out])
    return out, dur


def main():
    tmp = tempfile.mkdtemp(prefix="spdemo-")
    acts = [build_act(i, a, tmp) for i, a in enumerate(CFG["acts"], 1)]
    end, end_dur = build_end(acts[-1][0], tmp, CFG["end"])
    pieces = [p for p, _ in acts] + [end]
    total = sum(d for _, d in acts) + end_dur
    inputs = []
    for p in pieces:
        inputs += ["-i", p]
    chain = "".join(f"[{k}:v][{k}:a]" for k in range(len(pieces))) + f"concat=n={len(pieces)}:v=1:a=1[v][a];[a]loudnorm=I=-16:TP=-1.5[ao]"
    run([*inputs, "-filter_complex", chain, "-map", "[v]", "-map", "[ao]",
         "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", OUT])
    print(f"wrote {OUT}  ({total:.1f}s)")
    if total >= 180:
        print("WARNING: over 3 minutes; judges may stop watching at 3:00.")


if __name__ == "__main__":
    main()
