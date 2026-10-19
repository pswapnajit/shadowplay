/**
 * Shadow geometry: cast hand joints from a point-ish lamp onto a wall plane.
 *
 * Every joint is a sphere, every bone a tapered capsule. A sphere's shadow on
 * the wall is a disc; a capsule's shadow is (very nearly) the convex hull of
 * its two end discs — a 2D "uneven capsule". That lets both the GPU shadow
 * pass and the CPU scorer work on a short list of 2D shapes instead of 3D
 * meshes, which keeps the frame cheap on a standalone headset.
 *
 * Segment layout (8 floats): ax, ay, ra, sa, bx, by, rb, sb
 *   a/b: end-disc centres in wall coordinates (metres)
 *   r:   disc radius on the wall, s: penumbra half-width on the wall
 */

import {
  BONES_PER_HAND,
  CONTACT_PAIRS,
  J,
  JOINT_COUNT,
  SHADOW_BONE_RADIUS_SCALE,
  SHADOW_BONES,
  type V3,
} from './hand-data.js';
import type { Side } from './hand-model.js';

export const SEG_STRIDE = 8;

export interface Stage {
  lamp: V3;
  /** Centre of the projection area on the wall. */
  wallPoint: V3;
  /** Unit normal of the wall, pointing back into the room. */
  wallNormal: V3;
  wallRight: V3;
  wallUp: V3;
  /** Radius of the light source; sets how soft shadows get with distance. */
  lampRadius: number;
}

/** Head pose used to guess where the (untracked) elbow is. */
export interface HeadFrame {
  position: V3;
  right: V3;
  up: V3;
  forward: V3;
}

const FOREARM_WRIST_R = 0.024;
const FOREARM_ELBOW_R = 0.03;
/** Only the part of the forearm near the wrist is drawn; it fades out. */
export const FOREARM_LENGTH = 0.15;

/**
 * Where the elbow probably is: below and slightly in front of the shoulder
 * on the same side. Only the forearm's shadow depends on this guess.
 */
export function estimateElbow(head: HeadFrame, side: Side, out: V3): V3 {
  const s = side === 'right' ? 1 : -1;
  for (let i = 0; i < 3; i++) {
    out[i] =
      head.position[i] +
      head.right[i] * 0.2 * s +
      head.up[i] * -0.52 +
      head.forward[i] * 0.12;
  }
  return out;
}

/**
 * Projects n spheres (centres xyz, radii) through the lamp onto the wall.
 * out[i*4..] = u, v, r, soft. A point at or behind the lamp gets r = -1.
 */
export function projectSpheres(
  stage: Stage,
  centres: Float32Array,
  radii: ArrayLike<number>,
  n: number,
  out: Float32Array,
  outOffset = 0,
): void {
  const L = stage.lamp;
  const N = stage.wallNormal;
  const W = stage.wallPoint;
  const R = stage.wallRight;
  const U = stage.wallUp;
  // Signed distance of the lamp in front of the wall (positive).
  const lampToWall = (L[0] - W[0]) * N[0] + (L[1] - W[1]) * N[1] + (L[2] - W[2]) * N[2];
  for (let i = 0; i < n; i++) {
    const dx = centres[i * 3] - L[0];
    const dy = centres[i * 3 + 1] - L[1];
    const dz = centres[i * 3 + 2] - L[2];
    const along = -(dx * N[0] + dy * N[1] + dz * N[2]); // distance travelled towards the wall
    const o = outOffset + i * 4;
    if (along <= 0.01 || lampToWall <= 0) {
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = -1;
      out[o + 3] = 0;
      continue;
    }
    const t = lampToWall / along; // magnification
    const qx = L[0] + dx * t - W[0];
    const qy = L[1] + dy * t - W[1];
    const qz = L[2] + dz * t - W[2];
    out[o] = qx * R[0] + qy * R[1] + qz * R[2];
    out[o + 1] = qx * U[0] + qy * U[1] + qz * U[2];
    out[o + 2] = radii[i] * t;
    out[o + 3] = Math.max(0.002, stage.lampRadius * (t - 1));
  }
}

/**
 * Builds the shadow segments for one hand (bones + forearm).
 * `joints` holds 25 joint centres in world space, `radii` 25 radii.
 * Returns the number of segments written (BONES_PER_HAND, or 0 if the hand
 * is not in front of the lamp).
 */
export class HandShadowBuilder {
  private readonly centres = new Float32Array((JOINT_COUNT + 1) * 3);
  private readonly radii = new Float32Array(JOINT_COUNT + 1);
  private readonly proj = new Float32Array((JOINT_COUNT + 1) * 4);
  private readonly elbow: V3 = [0, 0, 0];

  build(
    stage: Stage,
    joints: Float32Array,
    radii: ArrayLike<number>,
    side: Side,
    head: HeadFrame | null,
    out: Float32Array,
    outSegOffset: number,
  ): number {
    this.centres.set(joints.subarray(0, JOINT_COUNT * 3));
    for (let i = 0; i < JOINT_COUNT; i++) this.radii[i] = radii[i];

    // Forearm end point: towards the estimated elbow, clamped in length.
    const wx = joints[0];
    const wy = joints[1];
    const wz = joints[2];
    let ex: number;
    let ey: number;
    let ez: number;
    if (head) {
      estimateElbow(head, side, this.elbow);
      ex = this.elbow[0] - wx;
      ey = this.elbow[1] - wy;
      ez = this.elbow[2] - wz;
    } else {
      // No head pose: extend straight back from the middle finger axis.
      ex = wx - joints[J.MIDDLE_PP * 3];
      ey = wy - joints[J.MIDDLE_PP * 3 + 1];
      ez = wz - joints[J.MIDDLE_PP * 3 + 2];
    }
    const el = Math.hypot(ex, ey, ez) || 1;
    const fl = Math.min(FOREARM_LENGTH, el);
    const fe = JOINT_COUNT * 3;
    this.centres[fe] = wx + (ex / el) * fl;
    this.centres[fe + 1] = wy + (ey / el) * fl;
    this.centres[fe + 2] = wz + (ez / el) * fl;
    this.radii[JOINT_COUNT] = FOREARM_ELBOW_R;

    projectSpheres(stage, this.centres, this.radii, JOINT_COUNT + 1, this.proj);
    if (this.proj[2] < 0) return 0; // wrist behind lamp

    let o = outSegOffset * SEG_STRIDE;
    for (let b = 0; b < SHADOW_BONES.length; b++) {
      const [ia, ib] = SHADOW_BONES[b];
      const k = SHADOW_BONE_RADIUS_SCALE[b];
      o = writeSeg(out, o, this.proj, ia, ib, k);
    }
    // Contact bridges: full width when the joints touch, fading out as
    // they separate, so the silhouette never pops.
    const c = this.centres;
    for (let b = 0; b < CONTACT_PAIRS.length; b++) {
      const [ia, ib] = CONTACT_PAIRS[b];
      const d = Math.hypot(c[ia * 3] - c[ib * 3], c[ia * 3 + 1] - c[ib * 3 + 1], c[ia * 3 + 2] - c[ib * 3 + 2]);
      const ratio = d / Math.max(1e-6, this.radii[ia] + this.radii[ib]);
      const k = 1 - smoothstep(1.2, 1.5, ratio);
      o = writeSeg(out, o, this.proj, ia, ib, k * 1.05);
    }
    // Forearm: wrist → elbow, a little thicker than the wrist joint.
    const p = this.proj;
    const wr = (FOREARM_WRIST_R / Math.max(1e-6, this.radii[0])) * p[2];
    out[o] = p[0];
    out[o + 1] = p[1];
    out[o + 2] = wr;
    out[o + 3] = p[3];
    const q = JOINT_COUNT * 4;
    out[o + 4] = p[q];
    out[o + 5] = p[q + 1];
    out[o + 6] = Math.max(0, p[q + 2]);
    out[o + 7] = p[q + 3];
    return BONES_PER_HAND;
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function writeSeg(out: Float32Array, o: number, p: Float32Array, ia: number, ib: number, k: number): number {
  const a = ia * 4;
  const b = ib * 4;
  out[o] = p[a];
  out[o + 1] = p[a + 1];
  out[o + 2] = Math.max(0, p[a + 2]) * k;
  out[o + 3] = p[a + 3];
  out[o + 4] = p[b];
  out[o + 5] = p[b + 1];
  out[o + 6] = Math.max(0, p[b + 2]) * k;
  out[o + 7] = p[b + 3];
  return o + SEG_STRIDE;
}

/**
 * The canonical stage used to author targets: a seated player whose head is
 * at the origin looking down -z, a lamp low and to the right, and a wall
 * 1.6 m ahead. Gameplay uses the real room, but matching is invariant to
 * position and scale, so targets authored here transfer.
 */
export const CANONICAL_HEAD: HeadFrame = {
  position: [0, 0, 0],
  right: [1, 0, 0],
  up: [0, 1, 0],
  forward: [0, 0, -1],
};

export function canonicalStage(lampSide: Side = 'right'): Stage {
  const s = lampSide === 'right' ? 1 : -1;
  return {
    // Beside and a little behind the head, like a lantern over the shoulder.
    lamp: [0.32 * s, -0.06, 0.28],
    wallPoint: [0, 0, -1.6],
    wallNormal: [0, 0, 1],
    wallRight: [1, 0, 0],
    wallUp: [0, 1, 0],
    lampRadius: 0.01,
  };
}
