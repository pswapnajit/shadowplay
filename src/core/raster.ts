/**
 * CPU rasteriser for shadow segments (see shadow-geom.ts for the layout).
 * Used for scoring at a few Hz, for authoring targets, and in tests.
 * The GPU pass in the runtime evaluates the same SDF per texel.
 */

import { SEG_STRIDE } from './shadow-geom.js';

/**
 * Signed distance from p to the 2D convex hull of two discs
 * (Inigo Quilez, "uneven capsule"), with a guard for nested discs.
 */
export function sdUnevenCapsule(
  px: number,
  py: number,
  ax: number,
  ay: number,
  ra: number,
  bx: number,
  by: number,
  rb: number,
): number {
  px -= ax;
  py -= ay;
  const ux = bx - ax;
  const uy = by - ay;
  const h = ux * ux + uy * uy;
  const bdiff = ra - rb;
  if (h <= bdiff * bdiff + 1e-12) {
    // One disc contains the other (or the segment is degenerate).
    if (ra >= rb) return Math.hypot(px, py) - ra;
    return Math.hypot(px - ux, py - uy) - rb;
  }
  const qx = Math.abs((px * uy - py * ux) / h);
  const qy = (px * ux + py * uy) / h;
  const cx = Math.sqrt(h - bdiff * bdiff);
  const cy = bdiff;
  const k = cx * qy - cy * qx;
  const m = cx * qx + cy * qy;
  const n = qx * qx + qy * qy;
  if (k < 0) return Math.sqrt(h * n) - ra;
  if (k > cx) return Math.sqrt(h * (n + 1 - 2 * qy)) - rb;
  return m - ra;
}

/** A square-celled grid laid over a 2D region. */
export class Grid {
  readonly data: Float32Array;
  constructor(
    readonly w: number,
    readonly h: number,
    /** World x/y of the centre of cell (0, 0). */
    public x0: number,
    public y0: number,
    public cell: number,
  ) {
    this.data = new Float32Array(w * h);
  }

  clear(): this {
    this.data.fill(0);
    return this;
  }

  /** Grid centred on (cx, cy) spanning `size` in both axes. */
  static centred(n: number, cx: number, cy: number, size: number): Grid {
    const cell = size / n;
    return new Grid(n, n, cx - size / 2 + cell / 2, cy - size / 2 + cell / 2, cell);
  }

  recentre(cx: number, cy: number, size: number): this {
    this.cell = size / this.w;
    this.x0 = cx - size / 2 + this.cell / 2;
    this.y0 = cy - size / 2 + this.cell / 2;
    return this;
  }
}

/**
 * Rasterises segments into the grid, taking the max coverage per cell.
 * soft=false gives a hard 0/1 mask (inside where SDF < 0).
 */
export function rasterize(segs: Float32Array, count: number, grid: Grid, soft = false): Grid {
  const { w, h, x0, y0, cell, data } = grid;
  for (let s = 0; s < count; s++) {
    const o = s * SEG_STRIDE;
    const ax = segs[o];
    const ay = segs[o + 1];
    const ra = segs[o + 2];
    const sa = segs[o + 3];
    const bx = segs[o + 4];
    const by = segs[o + 5];
    const rb = segs[o + 6];
    const sb = segs[o + 7];
    if (ra <= 0 && rb <= 0) continue;
    const pad = soft ? Math.max(sa, sb) : 0;
    const minX = Math.min(ax - ra, bx - rb) - pad;
    const maxX = Math.max(ax + ra, bx + rb) + pad;
    const minY = Math.min(ay - ra, by - rb) - pad;
    const maxY = Math.max(ay + ra, by + rb) + pad;
    const i0 = Math.max(0, Math.floor((minX - x0) / cell));
    const i1 = Math.min(w - 1, Math.ceil((maxX - x0) / cell));
    const j0 = Math.max(0, Math.floor((minY - y0) / cell));
    const j1 = Math.min(h - 1, Math.ceil((maxY - y0) / cell));
    if (i0 > i1 || j0 > j1) continue;
    for (let j = j0; j <= j1; j++) {
      const py = y0 + j * cell;
      const row = j * w;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + i * cell;
        const d = sdUnevenCapsule(px, py, ax, ay, ra, bx, by, rb);
        let c: number;
        if (soft) {
          // Penumbra width interpolated along the capsule is overkill; use the wider end.
          const sw = Math.max(sa, sb);
          c = 0.5 - d / (2 * sw);
          c = c < 0 ? 0 : c > 1 ? 1 : c;
        } else {
          c = d < 0 ? 1 : 0;
        }
        if (c > data[row + i]) data[row + i] = c;
      }
    }
  }
  return grid;
}

/** Min SDF over all segments, sampled at every cell centre. */
export function sdfField(segs: Float32Array, count: number, grid: Grid): Grid {
  const { w, h, x0, y0, cell, data } = grid;
  for (let j = 0; j < h; j++) {
    const py = y0 + j * cell;
    for (let i = 0; i < w; i++) {
      const px = x0 + i * cell;
      let d = 1e9;
      for (let s = 0; s < count; s++) {
        const o = s * SEG_STRIDE;
        if (segs[o + 2] <= 0 && segs[o + 6] <= 0) continue;
        const v = sdUnevenCapsule(px, py, segs[o], segs[o + 1], segs[o + 2], segs[o + 4], segs[o + 5], segs[o + 6]);
        if (v < d) d = v;
      }
      data[j * w + i] = d;
    }
  }
  return grid;
}

/** Bounding box of all segment discs: [minX, minY, maxX, maxY]. */
export function segmentBounds(segs: Float32Array, count: number, out: Float32Array): Float32Array {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let s = 0; s < count; s++) {
    const o = s * SEG_STRIDE;
    for (let k = 0; k <= 4; k += 4) {
      const r = segs[o + k + 2];
      if (r <= 0) continue;
      const x = segs[o + k];
      const y = segs[o + k + 1];
      if (x - r < minX) minX = x - r;
      if (y - r < minY) minY = y - r;
      if (x + r > maxX) maxX = x + r;
      if (y + r > maxY) maxY = y + r;
    }
  }
  out[0] = minX;
  out[1] = minY;
  out[2] = maxX;
  out[3] = maxY;
  return out;
}
