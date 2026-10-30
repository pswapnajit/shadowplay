/**
 * The garland of keepsakes: every finished tale leaves a small paper
 * cut-out hanging on a thread across the theatre, and they stay there on
 * later nights, so the wall shows how many stories it has seen. They hang
 * between the lantern and the wall, so (like the creatures) they are drawn
 * as shadows, and they swing when the story's wind blows.
 */

import type { SegWriter } from '../core/rigs.js';
import { GARLAND_MAX } from '../story/book.js';
import type { Keepsake } from '../story/protocol.js';

/**
 * Draws one keepsake in its own units: hung from (0, 0), about one unit
 * tall below it, half a unit either side. Strokes are bold because the
 * shadow texture is coarse (a centimetre a texel).
 */
type Glyph = (p: Pen) => void;

/** Places glyph units on the wall: a hanging point, a size and a swing angle. */
class Pen {
  w!: SegWriter;
  private x = 0;
  private y = 0;
  private k = 0.1;
  private c = 1;
  private s = 0;

  set(w: SegWriter, x: number, y: number, size: number, angle: number): this {
    this.w = w;
    this.x = x;
    this.y = y;
    this.k = size;
    this.c = Math.cos(angle);
    this.s = Math.sin(angle);
    return this;
  }

  cap(ax: number, ay: number, ra: number, bx: number, by: number, rb: number): void {
    const { x, y, k, c, s } = this;
    this.w.cap(x + k * (ax * c - ay * s), y + k * (ax * s + ay * c), ra * k, x + k * (bx * c - by * s), y + k * (bx * s + by * c), rb * k);
  }

  disc(cx: number, cy: number, r: number): void {
    this.cap(cx, cy, r, cx, cy, r);
  }

  /** Capsules through `pts` (x, y pairs) with a radius per point. */
  chain(pts: readonly number[], radii: readonly number[]): void {
    for (let i = 0; i + 1 < radii.length; i++) this.cap(pts[i * 2], pts[i * 2 + 1], radii[i], pts[i * 2 + 2], pts[i * 2 + 3], radii[i + 1]);
  }
}

const TAU = Math.PI * 2;
const STAR_TIPS = Array.from({ length: 5 }, (_, i) => [Math.cos(Math.PI / 2 + (i * TAU) / 5) * 0.46, -0.55 + Math.sin(Math.PI / 2 + (i * TAU) / 5) * 0.46]).flat();
const MOON_PTS = Array.from({ length: 7 }, (_, i) => {
  const a = (115 + (i * 130) / 6) * (Math.PI / 180);
  return [0.12 + Math.cos(a) * 0.38, -0.55 + Math.sin(a) * 0.38];
}).flat();
const MOON_R = Array.from({ length: 7 }, (_, i) => 0.05 + 0.15 * Math.sin((Math.PI * i) / 6));
const FEATHER_PTS = [0.06, -0.04, 0.04, -0.2, 0.0, -0.4, -0.04, -0.6, -0.07, -0.8, -0.09, -0.98];
const FEATHER_R = [0.04, 0.13, 0.2, 0.2, 0.14, 0.05];
const LEAF_PTS = [0, -0.14, 0, -0.3, 0, -0.5, 0, -0.68, 0, -0.84, 0, -0.98];
const LEAF_R = [0.05, 0.2, 0.27, 0.24, 0.14, 0.03];
const BELL_PTS = [0, -0.16, 0, -0.34, 0, -0.52, 0, -0.68];
const BELL_R = [0.13, 0.21, 0.28, 0.34];
const SAIL_PTS = [0.06, -0.16, 0.1, -0.32, 0.15, -0.48, 0.2, -0.62];
const SAIL_R = [0.04, 0.1, 0.16, 0.19];
const NUT_PTS = [0, -0.36, 0, -0.55, 0, -0.75, 0, -0.93];
const NUT_R = [0.25, 0.27, 0.19, 0.05];
const KITE_PTS = [0, -0.06, 0, -0.22, 0, -0.42, 0, -0.62, 0, -0.76];
const KITE_R = [0.04, 0.2, 0.28, 0.14, 0.03];
const TAIL_PTS = [0, -0.76, 0.08, -0.86, -0.05, -0.96, 0.06, -1.06];
const TAIL_R = [0.03, 0.03, 0.03, 0.03];

const GLYPHS: Record<Keepsake, Glyph> = {
  star: (p) => {
    p.disc(0, -0.55, 0.2);
    for (let i = 0; i < 10; i += 2) p.cap(0, -0.55, 0.17, STAR_TIPS[i], STAR_TIPS[i + 1], 0.05);
  },
  moon: (p) => p.chain(MOON_PTS, MOON_R),
  feather: (p) => {
    p.chain(FEATHER_PTS, FEATHER_R);
    p.cap(0.06, -0.04, 0.035, -0.12, -1.05, 0.035); // the quill
  },
  shell: (p) => {
    for (let i = 0; i < 5; i++) {
      const a = ((50 + i * 20) * Math.PI) / 180;
      p.cap(0, -0.9, 0.06, Math.cos(a) * 0.62, -0.9 + Math.sin(a) * 0.62, 0.15);
    }
    p.disc(-0.12, -0.92, 0.08);
    p.disc(0.12, -0.92, 0.08);
  },
  key: (p) => {
    for (let i = 0; i < 8; i++) {
      const a = (i * TAU) / 8;
      p.cap(Math.cos(a) * 0.2, -0.24 + Math.sin(a) * 0.2, 0.07, Math.cos(a + TAU / 8) * 0.2, -0.24 + Math.sin(a + TAU / 8) * 0.2, 0.07);
    }
    p.cap(0, -0.44, 0.075, 0, -0.98, 0.075);
    p.cap(0, -0.8, 0.065, 0.2, -0.8, 0.065);
    p.cap(0, -0.95, 0.065, 0.16, -0.95, 0.065);
  },
  leaf: (p) => {
    p.cap(0, 0, 0.04, 0, -0.14, 0.04);
    p.chain(LEAF_PTS, LEAF_R);
  },
  bell: (p) => {
    p.disc(0, -0.07, 0.08);
    p.chain(BELL_PTS, BELL_R);
    p.cap(-0.4, -0.76, 0.09, 0.4, -0.76, 0.09);
    p.disc(0, -0.92, 0.09);
  },
  boat: (p) => {
    p.cap(-0.44, -0.82, 0.08, 0.44, -0.82, 0.08);
    p.cap(-0.3, -0.93, 0.07, 0.3, -0.93, 0.07);
    p.cap(0, -0.82, 0.045, 0, -0.1, 0.04);
    p.chain(SAIL_PTS, SAIL_R);
  },
  acorn: (p) => {
    p.cap(0, 0, 0.035, 0.03, -0.12, 0.035);
    p.cap(-0.27, -0.24, 0.12, 0.27, -0.24, 0.12);
    p.chain(NUT_PTS, NUT_R);
  },
  snowflake: (p) => {
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 3;
      const x = Math.cos(a) * 0.42;
      const y = Math.sin(a) * 0.42;
      p.cap(-x, -0.55 - y, 0.06, x, -0.55 + y, 0.06);
      p.disc(x, -0.55 + y, 0.08);
      p.disc(-x, -0.55 - y, 0.08);
    }
  },
  kite: (p) => {
    p.chain(KITE_PTS, KITE_R);
    p.chain(TAIL_PTS, TAIL_R);
    p.disc(0.08, -0.86, 0.06);
    p.disc(-0.05, -0.96, 0.06);
  },
  crown: (p) => {
    p.cap(-0.38, -0.8, 0.12, 0.38, -0.8, 0.12);
    p.cap(-0.32, -0.72, 0.09, -0.38, -0.36, 0.04);
    p.cap(0, -0.72, 0.09, 0, -0.3, 0.04);
    p.cap(0.32, -0.72, 0.09, 0.38, -0.36, 0.04);
    p.disc(-0.38, -0.33, 0.08);
    p.disc(0, -0.27, 0.08);
    p.disc(0.38, -0.33, 0.08);
  },
};

function bounce(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

/** Wall metres. */
const HALF = 0.86;
const SAG = 0.07;
const SIZE = 0.12;

export class Garland {
  private readonly items: { k: Keepsake; drop: number }[] = [];
  private readonly pen = new Pen();
  /** Height of the thread's ends on the wall: low and bright when shown, up in the dim edge when not. */
  private y = 0.88;
  private alpha = 0;
  private t = 0;
  /** Hung low in the light (the opening, the end of a tale) rather than up out of the way. */
  shown = false;

  constructor(keepsakes: Keepsake[]) {
    for (const k of keepsakes) this.items.push({ k, drop: 1 });
  }

  get count(): number {
    return this.items.length;
  }

  /** A tale has ended: its keepsake drops onto the thread. */
  add(k: Keepsake): void {
    this.items.push({ k, drop: 0 });
    if (this.items.length > GARLAND_MAX) this.items.shift();
  }

  clear(): void {
    this.items.length = 0;
  }

  /** Writes the garland's shadow; `wind` (0..1) swings the keepsakes. */
  draw(w: SegWriter, dt: number, wind: number): void {
    this.t += dt;
    const n = this.items.length;
    this.y += ((this.shown ? 0.3 : 0.88) - this.y) * Math.min(1, dt * 1.6);
    this.alpha += ((n === 0 ? 0 : this.shown ? 1 : 0.4) - this.alpha) * Math.min(1, dt * 2);
    if (this.alpha < 0.01) return;
    const a = this.alpha;
    // The thread, sagging between its two pins.
    w.begin(0, 0, 1, 1, a * 0.75);
    const pieces = 14;
    for (let i = 0; i < pieces; i++) {
      const x0 = -HALF + (2 * HALF * i) / pieces;
      const x1 = -HALF + (2 * HALF * (i + 1)) / pieces;
      w.cap(x0, this.sagAt(x0), 0.0055, x1, this.sagAt(x1), 0.0055);
    }
    // The keepsakes, evenly spaced, each swinging on its own short thread.
    const gap = Math.min(0.15, (2 * HALF - 0.24) / Math.max(1, n - 1));
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      it.drop = Math.min(1, it.drop + dt / 1.5);
      const fall = 1 - bounce(it.drop);
      const x = (i - (n - 1) / 2) * gap;
      const top = this.sagAt(x);
      const swing = (0.08 + 0.3 * wind) * Math.sin(this.t * 1.15 + i * 1.7) + fall * 0.5 * Math.sin(this.t * 7);
      const hx = x + Math.sin(swing) * 0.03;
      const hy = top - 0.03 + fall * 0.55;
      const size = SIZE * (1 + 0.45 * Math.sin(Math.PI * it.drop) * (1 - it.drop * 0.6));
      w.begin(0, 0, 1, 1, a * 0.75);
      if (fall < 0.05) w.cap(x, top, 0.004, hx, hy, 0.004);
      w.begin(0, 0, 1, 1, a);
      GLYPHS[it.k](this.pen.set(w, hx, hy, size, swing));
    }
  }

  private sagAt(x: number): number {
    return this.y - SAG * (1 - (x / HALF) * (x / HALF));
  }
}
