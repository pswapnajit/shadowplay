#!/usr/bin/env python3
"""Cuts the director recording (tools/out/rec/{A,B}) into the demo video.

Each segment's screencast frames carry timestamps; they're resampled to a
constant 30 fps, cropped to 16:9, upscaled to 720p, joined with a short
crossfade, and captioned. Audio is the game's own output, recorded in-page.

Usage: python3 tools/build-video.py [out.mp4]
"""

import json
import os
import subprocess
import sys
import tempfile

FF = "/opt/homebrew/bin/ffmpeg"
ROOT = os.path.dirname(os.path.abspath(__file__))
REC = os.path.join(ROOT, "out", "rec")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "out", "shadowplay-demo.mp4")
FONT = "/System/Library/Fonts/Supplemental/Georgia.ttf"
FONT_I = "/System/Library/Fonts/Supplemental/Georgia Italic.ttf"
XFADE = 0.5
SPLIT = 52.4  # director time where segment B starts


def run(args):
    r = subprocess.run([FF, "-loglevel", "error", "-y", *args], capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-3000:])
        raise SystemExit(f"ffmpeg failed ({r.returncode})")


def segment(name: str, tmp: str) -> tuple[str, float]:
    meta = json.load(open(os.path.join(REC, name, "frames.json")))
    frames = meta["frames"]
    t0 = frames[0]["ts"]
    lst = os.path.join(tmp, f"{name}.txt")
    with open(lst, "w") as f:
        for i, fr in enumerate(frames):
            dur = (frames[i + 1]["ts"] - fr["ts"]) if i + 1 < len(frames) else 1 / 30
            f.write(f"file '{os.path.join(REC, name, 'frames', fr['file'])}'\nduration {max(dur, 0.001):.5f}\n")
        f.write(f"file '{os.path.join(REC, name, 'frames', frames[-1]['file'])}'\n")
    length = frames[-1]["ts"] - t0 + 1 / 30
    audio_skip = max(0.0, t0 - meta["audioT0"])  # audio began this much earlier
    out = os.path.join(tmp, f"{name}.mp4")
    run([
        "-f", "concat", "-safe", "0", "-i", lst,
        "-ss", f"{audio_skip:.3f}", "-i", os.path.join(REC, name, "audio.webm"),
        "-vf", (
            "fps=30,crop=756:425:0:10,"
            "scale=1280:720:flags=lanczos,unsharp=5:5:0.6,"
            "eq=contrast=1.12:saturation=1.08:gamma=0.97,format=yuv420p"
        ),
        "-af", "aresample=48000,apad",
        "-t", f"{length:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k",
        out,
    ])
    return out, length


# (start, end, text, style) in director seconds
CAPTIONS = [
    (5.6, 10.2, "A lantern glides over your shoulder. Your real wall becomes a stage.", "cap"),
    (10.6, 15.4, "A golden ghost hand shows the shape. Copy it...", "cap"),
    (15.6, 20.6, "...and the shadow wakes up.", "cap"),
    (21.0, 27.0, "Every creature you wake joins your menagerie on the wall.", "cap"),
    (27.4, 34.8, "Nine creatures to learn: a dog...", "cap"),
    (35.4, 43.2, "...tip its nose to the sky and it's a wolf, howling.", "cap"),
    (44.0, 51.8, "Matching is by shadow, not gesture: any hand that casts it wins.", "cap"),
    (53.4, 60.6, "Swans, foxes, deer...", "cap"),
    (61.4, 69.2, "Two hands make a crocodile that snaps.", "cap"),
    (78.6, 86.2, "...and a butterfly.", "cap"),
    (87.2, 99.0, "In free play, your shadows talk back.", "cap"),
    (99.8, 108.0, "Real shadow physics: near the lantern, big and soft. Near the wall, small and sharp.", "cap"),
]


def alpha(a: float, b: float, fade: float = 0.45) -> str:
    # quoted in the filtergraph, so commas need no escaping
    return (
        f"if(lt(t,{a:.2f}),0,if(lt(t,{a + fade:.2f}),(t-{a:.2f})/{fade},"
        f"if(lt(t,{b - fade:.2f}),1,if(lt(t,{b:.2f}),({b:.2f}-t)/{fade},0))))"
    )


def main() -> None:
    tmp = tempfile.mkdtemp(prefix="spvid-")
    a, la = segment("A", tmp)
    b, lb = segment("B", tmp)
    total = la + lb - XFADE

    # B's director time 52.4 lands at (la - XFADE) in the joined video.
    def T(t: float) -> float:
        return t if t < SPLIT else (la - XFADE) + (t - SPLIT)

    from PIL import Image, ImageDraw, ImageFilter, ImageFont

    W, H = 1280, 720
    overlays = []  # (png, start, end)

    def card(lines, name):
        """lines: (text, font_path, size, rgba, y, boxed)"""
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        g = ImageDraw.Draw(glow)
        for text, font, size, rgba, y, boxed in lines:
            f = ImageFont.truetype(font, size)
            l, t, r, b = d.textbbox((0, 0), text, font=f)
            x = (W - (r - l)) // 2 - l
            if boxed:
                pad = 14
                d.rounded_rectangle((x + l - pad, y + t - pad, x + r + pad, y + b + pad), radius=12, fill=(20, 13, 8, 170))
            else:
                g.text((x, y), text, font=f, fill=(255, 190, 110, 150))
            d.text((x, y), text, font=f, fill=rgba)
        glow = glow.filter(ImageFilter.GaussianBlur(10))
        out = Image.alpha_composite(glow, img)
        p = os.path.join(tmp, f"{name}.png")
        out.save(p)
        return p

    cream = (255, 241, 214, 255)
    overlays.append((card([("Shadowplay", FONT_I, 96, cream, 34, False),
                           ("a hand-shadow theatre for Meta Quest", FONT, 30, (255, 231, 194, 255), 150, False)], "title"), 0.6, 5.2))
    for i, (s0, e0, txt, _) in enumerate(CAPTIONS):
        overlays.append((card([(txt, FONT, 30, (255, 244, 226, 255), H - 96, True)], f"cap{i}"), T(s0), T(e0)))
    end0 = total - 6.2
    overlays.append((card([("Shadowplay", FONT_I, 84, cream, 170, False),
                           ("Hands only. Seated. On your own wall.", FONT, 32, (255, 231, 194, 255), 280, False),
                           ("Play it: pswapnajit.github.io/shadowplay", FONT, 30, (243, 201, 122, 255), 344, True),
                           ("Footage: Meta IWER Quest 3 emulator, scripted hand input. Built with the Immersive Web SDK.", FONT, 18, (255, 241, 214, 200), H - 40, False)],
                          "end"), end0, total + 0.5))

    inputs = ["-i", a, "-i", b]
    chain = [
        f"[0:v][1:v]xfade=transition=fade:duration={XFADE}:offset={la - XFADE:.3f}[v0]",
        f"[0:a][1:a]acrossfade=d={XFADE}[au]",
    ]
    cur = "v0"
    for k, (png, s0, e0) in enumerate(overlays):
        dur = max(0.5, e0 - s0)
        fd = 0.7 if k in (0, len(overlays) - 1) else 0.45
        inputs += ["-loop", "1", "-framerate", "30", "-t", f"{dur:.3f}", "-i", png]
        idx = 2 + k
        chain.append(
            f"[{idx}:v]format=rgba,fade=t=in:st=0:d={fd}:alpha=1,fade=t=out:st={max(0, dur - fd):.3f}:d={fd}:alpha=1,"
            f"setpts=PTS+{s0:.3f}/TB[o{k}]"
        )
        chain.append(f"[{cur}][o{k}]overlay=0:0:eof_action=pass[v{k + 1}]")
        cur = f"v{k + 1}"
    chain.append(f"[{cur}]fade=t=in:st=0:d=0.8,fade=t=out:st={total - 1.2:.2f}:d=1.2,format=yuv420p[vo]")
    chain.append(f"[au]afade=t=in:st=0:d=0.6,afade=t=out:st={total - 1.4:.2f}:d=1.4,loudnorm=I=-16:TP=-1.5[ao]")
    run([
        *inputs,
        "-filter_complex", ";".join(chain),
        "-map", "[vo]", "-map", "[ao]", "-t", f"{total:.3f}",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        OUT,
    ])
    print(f"wrote {OUT}  ({total:.1f}s)")


if __name__ == "__main__":
    main()
