/**
 * Living shadow creatures, drawn with the same capsule primitives as the
 * hand shadows so they share one look. Each rig draws one animation frame
 * in local coordinates: +x is the way the creature faces, +y is up, units
 * are metres at scale 1 (bodies are roughly 0.3 m long).
 */

import { SEG_STRIDE } from './shadow-geom.js';

export class SegWriter {
  n = 0;
  /** placement */
  ox = 0;
  oy = 0;
  s = 1;
  flip = 1;
  alpha = 1;
  constructor(
    public segs: Float32Array,
    public alphas: Float32Array,
  ) {}

  begin(ox: number, oy: number, s: number, facing: 1 | -1, alpha: number): this {
    this.ox = ox;
    this.oy = oy;
    this.s = s;
    this.flip = facing;
    this.alpha = alpha;
    return this;
  }

  cap(ax: number, ay: number, ra: number, bx: number, by: number, rb: number, a = 1): void {
    if (this.n * SEG_STRIDE + SEG_STRIDE > this.segs.length) return;
    const o = this.n * SEG_STRIDE;
    const s = this.s;
    this.segs[o] = this.ox + ax * s * this.flip;
    this.segs[o + 1] = this.oy + ay * s;
    this.segs[o + 2] = ra * s;
    this.segs[o + 3] = 0;
    this.segs[o + 4] = this.ox + bx * s * this.flip;
    this.segs[o + 5] = this.oy + by * s;
    this.segs[o + 6] = rb * s;
    this.segs[o + 7] = 0;
    this.alphas[this.n] = this.alpha * a;
    this.n++;
  }

  disc(x: number, y: number, r: number, a = 1): void {
    this.cap(x, y, r, x, y, r, a);
  }

  /** A chain of capsules through points with per-point radii. */
  chain(pts: number[], radii: number[], a = 1): void {
    for (let i = 0; i + 1 < radii.length; i++) {
      this.cap(pts[i * 2], pts[i * 2 + 1], radii[i], pts[i * 2 + 2], pts[i * 2 + 3], radii[i + 1], a);
    }
  }
}

const TAU = Math.PI * 2;

/** A limb of two segments swinging about a hip/shoulder. */
function leg(w: SegWriter, hx: number, hy: number, len: number, swing: number, r0: number, r1: number, knee = 0.5): void {
  const kx = hx + Math.sin(swing) * len * 0.5;
  const ky = hy - Math.cos(swing) * len * 0.5;
  const back = swing * knee - Math.max(0, -swing) * 0.6;
  const fx = kx + Math.sin(back) * len * 0.5;
  const fy = ky - Math.cos(back) * len * 0.5;
  w.cap(hx, hy, r0, kx, ky, (r0 + r1) / 2);
  w.cap(kx, ky, (r0 + r1) / 2, fx, fy, r1);
  w.cap(fx, fy, r1, fx + r1 * 2.2, fy, r1 * 0.8); // paw
}

export type RigFn = (w: SegWriter, t: number, action: number) => void;

/**
 * `t` is time in seconds; `action` 0..1 is a creature-specific flourish
 * (beak open, bark, snap, wing beat strength).
 */
export const RIGS: Record<string, RigFn> = {
  bird(w, t, action) {
    const flap = Math.sin(t * 13);
    // body and head
    w.cap(-0.07, 0.0, 0.034, 0.05, 0.012, 0.03);
    w.disc(0.085, 0.035, 0.03);
    const open = 0.015 * action;
    w.cap(0.105, 0.04 + open * 0.3, 0.009, 0.165, 0.035 + open, 0.002);
    w.cap(0.105, 0.03 - open * 0.3, 0.008, 0.155, 0.028 - open, 0.002);
    // tail fan
    w.cap(-0.08, 0.004, 0.016, -0.17, 0.035, 0.006);
    w.cap(-0.08, 0.0, 0.016, -0.175, 0.008, 0.006);
    w.cap(-0.08, -0.004, 0.016, -0.165, -0.02, 0.006);
    // wings: near wing full, far wing a beat behind and smaller
    for (const [k, ph] of [
      [1, 0],
      [0.75, 0.35],
    ] as const) {
      const a = (flap * 0.95 + 0.15) * k;
      const ex = -0.015;
      const ey = 0.03 + Math.sin(a + ph) * 0.07;
      const tx = -0.075;
      const ty = 0.03 + Math.sin(a + ph) * 0.15;
      w.chain([0.01, 0.025, ex, ey, tx, ty], [0.026 * k, 0.022 * k, 0.006], k);
      w.cap(ex, ey, 0.016 * k, tx - 0.04, ty - 0.02 * Math.sign(ty - 0.03 || 1), 0.004, k);
    }
  },

  rabbit(w, t, action) {
    const hop = Math.max(0, Math.sin(t * 6));
    const y = hop * 0.08;
    const lean = Math.cos(t * 6) * 0.25 * (hop > 0 ? 1 : 0);
    const ry = y;
    w.cap(-0.06, 0.07 + ry, 0.065, 0.03, 0.08 + ry + lean * 0.02, 0.05);
    w.disc(0.085, 0.13 + ry + lean * 0.03, 0.042);
    w.disc(0.118, 0.12 + ry + lean * 0.03, 0.022); // muzzle
    const flop = Math.sin(t * 6 + 1) * 0.04 + action * 0.03;
    w.cap(0.07, 0.16 + ry, 0.016, 0.02 - flop, 0.29 + ry, 0.01);
    w.cap(0.09, 0.16 + ry, 0.015, 0.075 - flop * 0.5, 0.3 + ry, 0.009);
    w.disc(-0.125, 0.09 + ry, 0.024); // tail
    // legs: big hind foot, small front paw
    const tuck = hop * 0.6;
    w.cap(-0.04, 0.035 + ry, 0.035, 0.03 - tuck * 0.05, 0.005 + ry * 0.4, 0.016);
    w.cap(0.05, 0.05 + ry, 0.016, 0.07 + tuck * 0.03, 0.005 + ry * 0.6, 0.011);
  },

  dog(w, t, action) {
    const sp = t * 9;
    const bob = Math.abs(Math.sin(sp)) * 0.012;
    const y = 0.16 + bob;
    w.cap(-0.12, y, 0.05, 0.08, y + 0.01, 0.056);
    w.disc(0.13, y + 0.075, 0.046);
    const jaw = 0.025 * action;
    w.cap(0.15, y + 0.075, 0.03, 0.235, y + 0.06, 0.02); // snout
    w.cap(0.15, y + 0.045, 0.02, 0.22, y + 0.035 - jaw, 0.012); // jaw
    w.cap(0.11, y + 0.11, 0.018, 0.085, y + 0.165, 0.012); // ear
    const wag = Math.sin(t * 16) * 0.35;
    w.cap(-0.16, y + 0.02, 0.014, -0.23 - Math.sin(wag) * 0.02, y + 0.08 + Math.cos(wag) * 0.02, 0.006);
    const L = 0.15;
    leg(w, -0.11, y - 0.01, L, Math.sin(sp) * 0.5, 0.024, 0.011);
    leg(w, -0.08, y - 0.01, L, Math.sin(sp + Math.PI) * 0.5, 0.022, 0.011, 0.4);
    leg(w, 0.06, y - 0.01, L, Math.sin(sp + Math.PI) * 0.5, 0.022, 0.011, 0.3);
    leg(w, 0.09, y - 0.01, L, Math.sin(sp) * 0.5, 0.02, 0.011, 0.3);
  },

  swan(w, t, action) {
    const bob = Math.sin(t * 2.2) * 0.006;
    const y = 0.05 + bob;
    w.cap(-0.13, y + 0.01, 0.055, 0.07, y, 0.05);
    w.cap(-0.17, y + 0.04, 0.028, -0.1, y + 0.03, 0.05); // raised tail
    w.cap(-0.09, y + 0.05, 0.035, 0.03, y + 0.055, 0.03); // folded wing
    const sway = Math.sin(t * 1.6) * 0.012 + action * 0.03;
    w.chain(
      [0.06, y + 0.04, 0.1, y + 0.11, 0.085 + sway, y + 0.19, 0.105 + sway, y + 0.26],
      [0.026, 0.02, 0.017, 0.015],
    );
    w.disc(0.125 + sway, y + 0.27, 0.022);
    w.cap(0.14 + sway, y + 0.268, 0.009, 0.185 + sway, y + 0.25, 0.003);
  },

  crocodile(w, t, action) {
    const und = t * 5;
    const snap = action;
    const y = 0.05;
    // body & tail as an undulating chain
    const pts: number[] = [];
    const rr = [0.006, 0.016, 0.03, 0.045, 0.05, 0.046];
    for (let i = 0; i < rr.length; i++) {
      const x = -0.36 + i * 0.09;
      pts.push(x, y + Math.sin(und - i * 0.9) * 0.012 * (1 - i / rr.length));
    }
    w.chain(pts, rr);
    // head and jaws
    const hx = 0.1;
    w.cap(hx, y + 0.01, 0.04, hx + 0.06, y + 0.02, 0.033);
    w.disc(hx + 0.07, y + 0.05, 0.015); // eye bump
    const open = 0.05 + snap * 0.25;
    w.cap(hx + 0.06, y + 0.025, 0.03, hx + 0.25, y + 0.02 + Math.sin(open) * 0.05, 0.014);
    w.cap(hx + 0.05, y - 0.005, 0.026, hx + 0.24, y - 0.01 - Math.sin(open) * 0.03, 0.012);
    // stubby legs
    for (const [lx, ph] of [
      [-0.12, 0],
      [-0.06, Math.PI],
      [0.05, Math.PI],
      [0.1, 0],
    ] as const) {
      const sw = Math.sin(und + ph) * 0.4;
      w.cap(lx, y - 0.02, 0.016, lx + Math.sin(sw) * 0.04, y - 0.06, 0.01);
    }
  },

  butterfly(w, t, action) {
    const beat = Math.abs(Math.cos(t * (9 + action * 6)));
    const sx = 0.25 + 0.75 * beat; // wings foreshorten as they beat
    w.cap(0, -0.04, 0.008, 0, 0.04, 0.012);
    w.disc(0, 0.05, 0.012);
    w.cap(0, 0.055, 0.003, 0.02, 0.095, 0.002);
    w.cap(0, 0.055, 0.003, -0.02, 0.095, 0.002);
    for (const side of [-1, 1]) {
      w.cap(0, 0.02, 0.012, side * 0.07 * sx, 0.065, 0.045);
      w.cap(0, 0.02, 0.01, side * 0.085 * sx, 0.02, 0.03);
      w.cap(0, -0.005, 0.01, side * 0.055 * sx, -0.045, 0.03);
    }
  },
};

/** Approximate local bounding height of each rig, used to size creatures. */
export const RIG_HEIGHT: Record<string, number> = {
  bird: 0.2,
  rabbit: 0.3,
  dog: 0.3,
  swan: 0.32,
  crocodile: 0.12,
  butterfly: 0.15,
};

export const TAU_CONST = TAU;
