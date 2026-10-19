/**
 * A small kinematic hand: finger and thumb joint angles in, 25 WebXR-ordered
 * joint positions out. Built on the captured REST skeleton so bone lengths
 * and radii match a real tracked hand.
 *
 * Used to author creature target poses, to drive the "show me" ghost hand,
 * and to test the shadow pipeline without a headset.
 */

import {
  FINGER_BASE,
  FINGERS,
  type FingerName,
  J,
  JOINT_COUNT,
  REST,
  type V3,
} from './hand-data.js';

/** Angles in degrees. Flexion bends towards the palm; abd spreads away from the middle finger. */
export interface FingerPose {
  mcp: number;
  pip: number;
  dip: number;
  abd: number;
}

/**
 * Thumb angles in degrees.
 * - flex: CMC swing across the palm towards the little finger (negative = out to the side)
 * - abd:  CMC swing away from the palm plane, in front of the palm (opposition)
 * - mcp, ip: curl of the two thumb joints
 */
export interface ThumbPose {
  flex: number;
  abd: number;
  mcp: number;
  ip: number;
}

export interface HandPose {
  thumb: ThumbPose;
  index: FingerPose;
  middle: FingerPose;
  ring: FingerPose;
  pinky: FingerPose;
}

export type Side = 'left' | 'right';

const D2R = Math.PI / 180;

// ---------------------------------------------------------------- vec utils
export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a: V3): number => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  dist: (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  lerp: (a: V3, b: V3, t: number): V3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
};

/** Rodrigues rotation of v about unit axis k by angle (radians). */
export function rotate(v: V3, k: V3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kv = v3.cross(k, v);
  const kd = v3.dot(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * kd,
    v[1] * c + kv[1] * s + k[1] * kd,
    v[2] * c + kv[2] * s + k[2] * kd,
  ];
}

const X: V3 = [1, 0, 0];
const Z: V3 = [0, 0, 1];

// Bone lengths from the captured skeleton.
const restP = REST.map((j) => j.p);
const boneLen = (a: number, b: number) => v3.dist(restP[a], restP[b]);

/** Spread direction sign per finger: +1 rotates towards the thumb side. */
const SPREAD_SIGN: Record<FingerName, number> = {
  index: 1,
  middle: -1,
  ring: -1,
  pinky: -1,
};

/**
 * Neutral (abd = 0) direction of each finger: the middle finger's
 * metacarpal axis, i.e. all fingers parallel and touching.
 */
const NEUTRAL_DIR: Record<FingerName, V3> = (() => {
  // Fingers held together converge slightly so their tips touch:
  // each finger is turned towards the middle finger by a few degrees.
  const mid = v3.norm(v3.sub(restP[J.MIDDLE_PP], restP[J.MIDDLE_MC]));
  const converge: Record<FingerName, number> = { index: 3.5, middle: 0, ring: 3.5, pinky: 7 };
  const out = {} as Record<FingerName, V3>;
  for (const f of FINGERS) out[f] = rotate(mid, Z, -converge[f] * SPREAD_SIGN[f] * D2R);
  return out;
})();

export const OPEN_HAND: HandPose = {
  thumb: { flex: -10, abd: 10, mcp: 5, ip: 5 },
  index: { mcp: 0, pip: 0, dip: 0, abd: 8 },
  middle: { mcp: 0, pip: 0, dip: 0, abd: 0 },
  ring: { mcp: 0, pip: 0, dip: 0, abd: 8 },
  pinky: { mcp: 0, pip: 0, dip: 0, abd: 18 },
};

export function clonePose(p: HandPose): HandPose {
  return {
    thumb: { ...p.thumb },
    index: { ...p.index },
    middle: { ...p.middle },
    ring: { ...p.ring },
    pinky: { ...p.pinky },
  };
}

export function lerpPose(a: HandPose, b: HandPose, t: number): HandPose {
  const lf = (x: FingerPose, y: FingerPose): FingerPose => ({
    mcp: x.mcp + (y.mcp - x.mcp) * t,
    pip: x.pip + (y.pip - x.pip) * t,
    dip: x.dip + (y.dip - x.dip) * t,
    abd: x.abd + (y.abd - x.abd) * t,
  });
  return {
    thumb: {
      flex: a.thumb.flex + (b.thumb.flex - a.thumb.flex) * t,
      abd: a.thumb.abd + (b.thumb.abd - a.thumb.abd) * t,
      mcp: a.thumb.mcp + (b.thumb.mcp - a.thumb.mcp) * t,
      ip: a.thumb.ip + (b.thumb.ip - a.thumb.ip) * t,
    },
    index: lf(a.index, b.index),
    middle: lf(a.middle, b.middle),
    ring: lf(a.ring, b.ring),
    pinky: lf(a.pinky, b.pinky),
  };
}

/**
 * Joint positions of a RIGHT hand in the palm frame (+x ulnar, +y distal,
 * +z dorsal). Writes 25×3 floats into `out`.
 */
export function poseJointsPalm(pose: HandPose, out: Float32Array): Float32Array {
  const put = (i: number, p: V3) => {
    out[i * 3] = p[0];
    out[i * 3 + 1] = p[1];
    out[i * 3 + 2] = p[2];
  };
  put(J.WRIST, restP[J.WRIST]);

  // Long fingers. The metacarpal joint and knuckle are rigid in the palm.
  // abd = 0 means "parallel to the middle finger" (fingers held together);
  // positive abd spreads the finger away from the middle finger.
  for (const f of FINGERS) {
    const b = FINGER_BASE[f];
    const fp = pose[f];
    const knuckle = restP[b + 1];
    put(b, restP[b]);
    put(b + 1, knuckle);
    const m = NEUTRAL_DIR[f];
    // Flexion axis: rotating about (Z × m) swings m towards -z (palmar).
    let flexAxis = v3.norm(v3.cross(Z, m));
    const abd = fp.abd * SPREAD_SIGN[f] * D2R;
    let d = rotate(m, Z, abd);
    flexAxis = rotate(flexAxis, Z, abd);
    d = rotate(d, flexAxis, fp.mcp * D2R);
    const p1 = v3.add(knuckle, v3.scale(d, boneLen(b + 1, b + 2)));
    d = rotate(d, flexAxis, fp.pip * D2R);
    const p2 = v3.add(p1, v3.scale(d, boneLen(b + 2, b + 3)));
    d = rotate(d, flexAxis, fp.dip * D2R);
    const p3 = v3.add(p2, v3.scale(d, boneLen(b + 3, b + 4)));
    put(b + 2, p1);
    put(b + 3, p2);
    put(b + 4, p3);
  }

  // Thumb. The CMC joint sits at the base; the metacarpal swings from it.
  const cmc = restP[J.THUMB_MC];
  put(J.THUMB_MC, cmc);
  const restDir = v3.norm(v3.sub(restP[J.THUMB_PP], cmc));
  const tp = pose.thumb;
  // Swing across the palm (about the palm normal) towards +x (ulnar).
  let t = rotate(restDir, Z, -tp.flex * D2R);
  // Swing out of the palm plane towards -z (opposition). Rotating about
  // k = Z×t moves t along k×t, which points to -z.
  const abdAxis = v3.norm(v3.cross(Z, t));
  t = rotate(t, abdAxis, tp.abd * D2R);
  // Curl bends the thumb towards the base of the little finger
  // (ulnar and palmar). Rotating about t×c moves t towards c.
  const curlTo: V3 = v3.norm([0.8, 0, -0.6]);
  const curlAxis = v3.norm(v3.cross(t, curlTo));
  const mc = v3.add(cmc, v3.scale(t, boneLen(J.THUMB_MC, J.THUMB_PP)));
  let d = rotate(t, curlAxis, tp.mcp * D2R);
  const dp = v3.add(mc, v3.scale(d, boneLen(J.THUMB_PP, J.THUMB_DP)));
  d = rotate(d, curlAxis, tp.ip * D2R);
  const tip = v3.add(dp, v3.scale(d, boneLen(J.THUMB_DP, J.THUMB_TIP)));
  put(J.THUMB_PP, mc);
  put(J.THUMB_DP, dp);
  put(J.THUMB_TIP, tip);
  return out;
}

/** 3×3 rotation (column vectors x, y, z) from a finger direction and a back-of-hand direction. */
export interface Frame {
  x: V3;
  y: V3;
  z: V3;
}

export function frameFromDirs(fingerDir: V3, dorsalDir: V3): Frame {
  const y = v3.norm(fingerDir);
  let z = v3.sub(dorsalDir, v3.scale(y, v3.dot(dorsalDir, y)));
  z = v3.norm(z);
  const x = v3.cross(y, z);
  return { x, y, z };
}

/** Rotates a frame about an axis (radians) — handy for tilting authored poses. */
export function rotateFrame(f: Frame, axis: V3, angle: number): Frame {
  const k = v3.norm(axis);
  return { x: rotate(f.x, k, angle), y: rotate(f.y, k, angle), z: rotate(f.z, k, angle) };
}

/**
 * Places palm-frame joints in world space. For a left hand the palm-frame x
 * is mirrored first, so the same (fingerDir, dorsalDir) gives the anatomical
 * mirror image, exactly like a real pair of hands.
 */
export function placeJoints(
  palm: Float32Array,
  side: Side,
  frame: Frame,
  wristPos: V3,
  out: Float32Array,
): Float32Array {
  const sx = side === 'left' ? -1 : 1;
  for (let i = 0; i < JOINT_COUNT; i++) {
    const px = palm[i * 3] * sx;
    const py = palm[i * 3 + 1];
    const pz = palm[i * 3 + 2];
    out[i * 3] = wristPos[0] + frame.x[0] * px + frame.y[0] * py + frame.z[0] * pz;
    out[i * 3 + 1] = wristPos[1] + frame.x[1] * px + frame.y[1] * py + frame.z[1] * pz;
    out[i * 3 + 2] = wristPos[2] + frame.x[2] * px + frame.y[2] * py + frame.z[2] * pz;
  }
  return out;
}

export const REST_RADII = new Float32Array(REST.map((j) => j.r));

export { X as AXIS_X, Z as AXIS_Z };
