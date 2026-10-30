/**
 * Shape matching for shadow puppets.
 *
 * A shadow is reduced to a translation-, scale- and (mildly) rotation-
 * invariant mask: centre on its centroid, scale so its area is 1, then
 * compare against each target with intersection-over-union. Mirroring is
 * allowed, so left- and right-handed players, and a lamp on either side,
 * all work with the same targets.
 */

import { Grid, rasterize } from './raster.js';
import { SEG_STRIDE } from './shadow-geom.js';

/** Normalised mask resolution and extent (in units of sqrt(area)). */
export const NORM_RES = 48;
export const NORM_EXTENT = 4.2;
const COARSE_RES = 64;

export interface ShapeFrame {
  cx: number;
  cy: number;
  /** sqrt of the shadow's area (metres). */
  scale: number;
  area: number;
}

export interface MatchResult {
  iou: number;
  angle: number; // radians applied to the player's shape
  mirror: boolean;
  frame: ShapeFrame;
}

const coarse = new Grid(COARSE_RES, COARSE_RES, 0, 0, 1);

/** Centroid and area of the hard mask of `segs`, measured on a coarse grid. */
export function measureShape(segs: Float32Array, count: number, out?: ShapeFrame): ShapeFrame | null {
  // Bounds first, so the grid covers the shape tightly.
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
      minX = Math.min(minX, x - r);
      maxX = Math.max(maxX, x + r);
      minY = Math.min(minY, y - r);
      maxY = Math.max(maxY, y + r);
    }
  }
  if (!Number.isFinite(minX)) return null;
  const size = Math.max(maxX - minX, maxY - minY) * 1.04;
  coarse.recentre((minX + maxX) / 2, (minY + maxY) / 2, size);
  rasterize(segs, count, coarse.clear(), false);
  let sum = 0;
  let sx = 0;
  let sy = 0;
  const { data, w, x0, y0, cell } = coarse;
  for (let j = 0; j < w; j++) {
    for (let i = 0; i < w; i++) {
      if (data[j * w + i] > 0.5) {
        sum++;
        sx += x0 + i * cell;
        sy += y0 + j * cell;
      }
    }
  }
  if (sum < 4) return null;
  const area = sum * cell * cell;
  const f = out ?? { cx: 0, cy: 0, scale: 1, area: 0 };
  f.cx = sx / sum;
  f.cy = sy / sum;
  f.area = area;
  f.scale = Math.sqrt(area);
  return f;
}

/**
 * Writes `segs` transformed into the normalised frame:
 *   p' = R(angle) · M · (p − c) / scale,  r' = r / scale
 * where M mirrors x when `mirror` is set.
 */
export function normaliseSegments(
  segs: Float32Array,
  count: number,
  frame: ShapeFrame,
  angle: number,
  mirror: boolean,
  out: Float32Array,
): Float32Array {
  const inv = 1 / frame.scale;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = mirror ? -1 : 1;
  for (let i = 0; i < count; i++) {
    const o = i * SEG_STRIDE;
    for (let k = 0; k <= 4; k += 4) {
      const x = (segs[o + k] - frame.cx) * inv * m;
      const y = (segs[o + k + 1] - frame.cy) * inv;
      out[o + k] = c * x - s * y;
      out[o + k + 1] = s * x + c * y;
      out[o + k + 2] = segs[o + k + 2] * inv;
      out[o + k + 3] = segs[o + k + 3] * inv;
    }
  }
  return out;
}

export function newNormGrid(): Grid {
  return Grid.centred(NORM_RES, 0, 0, NORM_EXTENT);
}

export function iou(a: Grid, b: Grid): number {
  let inter = 0;
  let uni = 0;
  const da = a.data;
  const db = b.data;
  for (let i = 0; i < da.length; i++) {
    const x = da[i] > 0.5;
    const y = db[i] > 0.5;
    if (x && y) inter++;
    if (x || y) uni++;
  }
  return uni === 0 ? 0 : inter / uni;
}

/** A target silhouette prepared for matching. */
export interface Target {
  id: string;
  mask: Grid; // normalised hard mask
  segs: Float32Array; // normalised segments (for outline rendering)
  count: number;
  /** sqrt(area) of the authored shadow on the canonical wall, metres. */
  scale0: number;
}

export function makeTarget(id: string, segs: Float32Array, count: number): Target {
  const frame = measureShape(segs, count);
  if (!frame) throw new Error(`target ${id} has no shadow`);
  const norm = normaliseSegments(segs, count, frame, 0, false, new Float32Array(count * SEG_STRIDE));
  const mask = rasterize(norm, count, newNormGrid(), false);
  return { id, mask, segs: norm, count, scale0: frame.scale };
}

const ANGLES = [-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42];

/**
 * Scores a live shadow against a target. Allocates nothing per call after
 * the first; safe to run several times a second on a headset.
 */
export class ShapeMatcher {
  private readonly frame: ShapeFrame = { cx: 0, cy: 0, scale: 1, area: 0 };
  private readonly grid = newNormGrid();
  private norm = new Float32Array(0);
  readonly result: MatchResult = {
    iou: 0,
    angle: 0,
    mirror: false,
    frame: { cx: 0, cy: 0, scale: 1, area: 0 },
  };

  /** Returns null when there is no usable shadow. */
  match(segs: Float32Array, count: number, target: Target, allowMirror = true): MatchResult | null {
    if (count === 0 || !measureShape(segs, count, this.frame)) return null;
    if (this.norm.length < count * SEG_STRIDE) this.norm = new Float32Array(count * SEG_STRIDE);
    let best = -1;
    let bestAngle = 0;
    let bestMirror = false;
    for (let mi = 0; mi < (allowMirror ? 2 : 1); mi++) {
      const mirror = mi === 1;
      for (const a of ANGLES) {
        normaliseSegments(segs, count, this.frame, a, mirror, this.norm);
        rasterize(this.norm, count, this.grid.clear(), false);
        const v = iou(this.grid, target.mask);
        if (v > best) {
          best = v;
          bestAngle = a;
          bestMirror = mirror;
        }
      }
    }
    const r = this.result;
    r.iou = best;
    r.angle = bestAngle;
    r.mirror = bestMirror;
    r.frame.cx = this.frame.cx;
    r.frame.cy = this.frame.cy;
    r.frame.scale = this.frame.scale;
    r.frame.area = this.frame.area;
    return r;
  }

  private readonly many: MatchResult[] = [];

  /**
   * Scores one live shadow against several targets, rasterising it once per
   * angle instead of once per angle per target. Results line up with
   * `targets` (valid until the next call); null when there is no shadow.
   */
  matchAll(segs: Float32Array, count: number, targets: readonly Target[]): readonly MatchResult[] | null {
    if (count === 0 || !measureShape(segs, count, this.frame)) return null;
    if (this.norm.length < count * SEG_STRIDE) this.norm = new Float32Array(count * SEG_STRIDE);
    while (this.many.length < targets.length) this.many.push({ iou: 0, angle: 0, mirror: false, frame: { cx: 0, cy: 0, scale: 1, area: 0 } });
    for (let i = 0; i < targets.length; i++) this.many[i].iou = -1;
    for (let mi = 0; mi < 2; mi++) {
      const mirror = mi === 1;
      for (const a of ANGLES) {
        normaliseSegments(segs, count, this.frame, a, mirror, this.norm);
        rasterize(this.norm, count, this.grid.clear(), false);
        for (let i = 0; i < targets.length; i++) {
          const v = iou(this.grid, targets[i].mask);
          const r = this.many[i];
          if (v > r.iou) {
            r.iou = v;
            r.angle = a;
            r.mirror = mirror;
          }
        }
      }
    }
    for (let i = 0; i < targets.length; i++) {
      const f = this.many[i].frame;
      f.cx = this.frame.cx;
      f.cy = this.frame.cy;
      f.scale = this.frame.scale;
      f.area = this.frame.area;
    }
    return this.many;
  }
}
