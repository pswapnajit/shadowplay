#!/usr/bin/env python3
"""Cuts the story recording (tools/out/rec/S1..Sn, made by tools/record-story.mjs)
into the demo video.

The segments were recorded with the game frozen between them, so they join
with hard cuts and no visible seam. Long waits for the storyteller are
shortened (the cut is visible: a short dip), the Lantern's lines are
subtitled from the recorded transcript, and a title, a few captions and an
end card are laid over the top.

Usage: python3 tools/build-story-video.py [out.mp4]
Config (optional) tools/story-video.json:
  {"segments": ["S1", "S2"], "maxWait": 4.0, "cuts": [[t0, t1]], "captions": [{"at": "ask1", "text": "...", "dur": 4}]}
  Caption anchors: start, seek, story, ask<N>, made<N>, cue:<name>, end, free (+ "offset": seconds).
"""

import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FF = "/opt/homebrew/bin/ffmpeg"
ROOT = os.path.dirname(os.path.abspath(__file__))
REC = os.path.join(ROOT, "out", "rec")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "out", "shadowplay-story.mp4")
CFG_PATH = os.path.join(ROOT, "story-video.json")
CFG = json.load(open(CFG_PATH)) if os.path.exists(CFG_PATH) else {}
FONT = "/System/Library/Fonts/Supplemental/Georgia.ttf"
FONT_I = "/System/Library/Fonts/Supplemental/Georgia Italic.ttf"
W, H = 1280, 720


def run(args):
    r = subprocess.run([FF, "-loglevel", "error", "-y", *args], capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-3000:])
        raise SystemExit(f"ffmpeg failed ({r.returncode})")


def segment(name, tmp):
    """One recorded segment, live part only, as a 30 fps 720p clip with its audio."""
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
    run([
        "-f", "concat", "-safe", "0", "-i", lst,
        "-ss", f"{max(0.0, t0 - meta['audioT0']):.3f}", "-i", os.path.join(REC, name, "audio.webm"),
        "-vf", (
            "fps=30,crop=756:425:0:10,"
            "scale=1280:720:flags=lanczos,unsharp=5:5:0.6,"
            "eq=contrast=1.12:saturation=1.08:gamma=0.97,format=yuv420p"
        ),
        "-af", "aresample=48000,apad",
        "-t", f"{length:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "17",
        "-c:a", "aac", "-b:a", "192k",
        out,
    ])
    story = json.load(open(os.path.join(REC, name, "story.json")))
    return out, length, story


def keep_ranges(total, cuts):
    cuts = sorted([max(0.0, a), min(total, b)] for a, b in cuts if b > a)
    keep, t = [], 0.0
    for a, b in cuts:
        if a > t:
            keep.append((t, a))
        t = max(t, b)
    if t < total:
        keep.append((t, total))
    return keep


def card(lines, name, tmp, backdrop=0):
    """lines: (text, font, size, rgba, y, boxed). Returns a transparent 1280x720 PNG path.
    `backdrop` (0..255) darkens the whole frame underneath (end card)."""
    img = Image.new("RGBA", (W, H), (12, 8, 5, backdrop))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    g = ImageDraw.Draw(glow)
    for text, font, size, rgba, y, boxed in lines:
        f = ImageFont.truetype(font, size)
        # wrap to the frame
        words, rows, row = text.split(), [], ""
        for w in words:
            trial = f"{row} {w}".strip()
            if d.textlength(trial, font=f) > W * 0.86 and row:
                rows.append(row)
                row = w
            else:
                row = trial
        rows.append(row)
        for k, r in enumerate(rows):
            yy = y + k * int(size * 1.3) - (len(rows) - 1) * int(size * 1.3) * (1 if y > H / 2 else 0)
            l, t, rr, b = d.textbbox((0, 0), r, font=f)
            x = (W - (rr - l)) // 2 - l
            if boxed:
                pad = 12
                d.rounded_rectangle((x + l - pad, yy + t - pad, x + rr + pad, yy + b + pad), radius=12, fill=(20, 13, 8, 165))
            else:
                g.text((x, yy), r, font=f, fill=(255, 190, 110, 150))
            d.text((x, yy), r, font=f, fill=rgba)
    out = Image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(10)), img)
    p = os.path.join(tmp, f"{name}.png")
    out.save(p)
    return p


def main():
    tmp = tempfile.mkdtemp(prefix="spstory-")
    names = CFG.get("segments") or sorted(n for n in os.listdir(REC) if n.startswith("S") and os.path.isdir(os.path.join(REC, n)))
    clips, events, offset = [], [], 0.0
    for n in names:
        clip, length, story = segment(n, tmp)
        clips.append(clip)
        for e in story:
            events.append({**e, "t": e["t"] + offset})
        offset += length
    total = offset

    # Join the segments (identical encoding, so the concat demuxer is enough).
    joined = os.path.join(tmp, "joined.mp4")
    with open(os.path.join(tmp, "join.txt"), "w") as f:
        for c in clips:
            f.write(f"file '{c}'\n")
    run(["-f", "concat", "-safe", "0", "-i", os.path.join(tmp, "join.txt"), "-c", "copy", joined])

    # Shorten long waits for the storyteller: after a creature wakes, keep its
    # wake (3 s) and the moment before the first line.
    cuts = [tuple(c) for c in CFG.get("cuts", [])]
    max_wait = CFG.get("maxWait", 4.0)
    says = [e for e in events if "say" in e]
    for e in events:
        if e.get("story") == "telling":
            nxt = next((s for s in says if s["t"] > e["t"]), None)
            if nxt and nxt["t"] - e["t"] > max_wait:
                cuts.append((e["t"] + 3.0, nxt["t"] - 0.7))
    keep = keep_ranges(total, cuts)

    def mapped(t):
        """Pre-cut time to post-cut time (None if it was cut)."""
        acc = 0.0
        for a, b in keep:
            if a <= t <= b:
                return acc + (t - a)
            acc += b - a
        return None

    final = sum(b - a for a, b in keep)

    # Anchors for captions.
    anchors = {"start": 0.0}
    asks = [e for e in events if e.get("story") == "asking"]
    for i, e in enumerate(asks, 1):
        anchors[f"ask{i}"] = e["t"]
    tellings = [e for e in events if e.get("story") == "telling"]
    made = [t for t in tellings if any(a["t"] < t["t"] for a in asks)]
    for i, e in enumerate(made, 1):
        anchors[f"made{i}"] = e["t"]
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

    overlays = []  # (png, start, end) in final time
    cream = (255, 241, 214, 255)
    overlays.append((card([("Shadowplay", FONT_I, 92, cream, 40, False),
                           ("a hand-shadow theatre with a storyteller, for Meta Quest", FONT, 28, (255, 231, 194, 255), 150, False)], "title", tmp), 0.5, 5.5))
    for i, c in enumerate(CFG.get("captions", [])):
        at = anchors.get(c["at"])
        if at is None:
            continue
        s0 = mapped(at + c.get("offset", 0.0))
        if s0 is None:
            continue
        overlays.append((card([(c["text"], FONT, 27, (255, 244, 226, 255), 34, True)], f"cap{i}", tmp), s0, s0 + c.get("dur", 4.0)))
    # The Lantern's own words, subtitled from the transcript.
    for i, s in enumerate(says):
        s0 = mapped(s["t"])
        if s0 is None:
            continue
        nxt = says[i + 1]["t"] if i + 1 < len(says) else s["t"] + 7
        s1 = mapped(min(nxt, s["t"] + 9.5)) or (s0 + 6)
        overlays.append((card([(s["say"], FONT_I, 30, (255, 241, 214, 255), H - 70, True)], f"say{i}", tmp), s0 + 0.2, max(s0 + 1.5, s1 - 0.15)))
    end0 = final - 7.0
    overlays.append((card([("Shadowplay", FONT_I, 80, cream, 160, False),
                           ("Hands only. Seated. On your own wall. A new story every night.", FONT, 30, (255, 231, 194, 255), 270, False),
                           ("Play it: pswapnajit.github.io/shadowplay", FONT, 30, (243, 201, 122, 255), 334, True),
                           ("Footage: Meta IWER Quest 3 emulator with scripted hand input. The story was told live by Claude.", FONT, 18, (255, 241, 214, 200), H - 46, False)],
                          "end", tmp, backdrop=190), end0, final + 0.5))

    inputs = ["-i", joined]
    chain = []
    parts = []
    for k, (a, b) in enumerate(keep):
        chain.append(f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS[pv{k}]")
        chain.append(f"[0:a]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.05,afade=t=out:st={max(0, b - a - 0.05):.3f}:d=0.05[pa{k}]")
        parts.append(f"[pv{k}][pa{k}]")
    chain.append(f"{''.join(parts)}concat=n={len(keep)}:v=1:a=1[v0][au]")
    cur = "v0"
    for k, (png, s0, e0) in enumerate(overlays):
        dur = max(0.5, e0 - s0)
        fd = 0.6 if k in (0, len(overlays) - 1) else 0.3
        inputs += ["-loop", "1", "-framerate", "30", "-t", f"{dur:.3f}", "-i", png]
        chain.append(
            f"[{k + 1}:v]format=rgba,fade=t=in:st=0:d={fd}:alpha=1,fade=t=out:st={max(0, dur - fd):.3f}:d={fd}:alpha=1,"
            f"setpts=PTS+{s0:.3f}/TB[o{k}]"
        )
        chain.append(f"[{cur}][o{k}]overlay=0:0:eof_action=pass[x{k}]")
        cur = f"x{k}"
    chain.append(f"[{cur}]fade=t=in:st=0:d=0.8,fade=t=out:st={final - 1.2:.2f}:d=1.2,format=yuv420p[vo]")
    chain.append(f"[au]afade=t=in:st=0:d=0.6,afade=t=out:st={final - 1.4:.2f}:d=1.4,loudnorm=I=-16:TP=-1.5[ao]")
    script = os.path.join(tmp, "graph.txt")
    open(script, "w").write(";\n".join(chain))
    run([
        *inputs,
        "-/filter_complex", script,
        "-map", "[vo]", "-map", "[ao]", "-t", f"{final:.3f}",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        OUT,
    ])
    print(f"wrote {OUT}  ({final:.1f}s from {total:.1f}s recorded; {len(keep) - 1} cuts)")
    if final >= 180:
        print("WARNING: over 3 minutes; judges may stop watching at 3:00. Add cuts in tools/story-video.json.")


if __name__ == "__main__":
    main()
