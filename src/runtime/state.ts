/**
 * Shared, mutable app state. Systems read and write it each frame; nothing
 * here allocates per frame.
 */

import { BONES_PER_HAND, JOINT_COUNT, type V3 } from '../core/hand-data.js';
import type { Side } from '../core/hand-model.js';
import { type HeadFrame, SEG_STRIDE, type Stage } from '../core/shadow-geom.js';

export type HandSourceKind = 'xr' | 'webcam' | 'demo' | 'none';

export interface HandFrame {
  side: Side;
  tracked: boolean;
  /** World-space joint centres, WebXR order, 25×3. */
  joints: Float32Array;
  radii: Float32Array;
}

export type Tolerance = 'easy' | 'normal' | 'expert';

export interface Settings {
  lampSide: Side;
  tolerance: Tolerance;
  highContrast: boolean;
  muted: boolean;
  captions: boolean;
}

export const MAX_SEGMENTS = 512;

function makeHand(side: Side): HandFrame {
  return {
    side,
    tracked: false,
    joints: new Float32Array(JOINT_COUNT * 3),
    radii: new Float32Array(JOINT_COUNT),
  };
}

export const state = {
  /** Where the theatre is. Null until placed. */
  stage: null as Stage | null,
  /** Size of the square shadow region on the wall, metres. */
  regionSize: 2.4,
  /** True when the wall came from real scene understanding. */
  realWall: false,
  head: {
    position: [0, 1.2, 0],
    right: [1, 0, 0],
    up: [0, 1, 0],
    forward: [0, 0, -1],
  } as HeadFrame,
  hands: [makeHand('left'), makeHand('right')] as [HandFrame, HandFrame],
  handSource: 'none' as HandSourceKind,

  /** Player's hand shadow segments (wall coordinates). */
  handSegs: new Float32Array(2 * BONES_PER_HAND * SEG_STRIDE),
  handSegCount: 0,
  /** Creature shadow segments (wall coordinates) and per-segment opacity. */
  creatureSegs: new Float32Array(MAX_SEGMENTS * SEG_STRIDE),
  creatureAlpha: new Float32Array(MAX_SEGMENTS),
  creatureSegCount: 0,

  /** Typical magnification of the hands this frame (for blur and sizing). */
  magnification: 2.5,

  settings: {
    lampSide: 'right',
    tolerance: 'normal',
    highContrast: false,
    muted: false,
    captions: true,
  } as Settings,

  /** Desktop preview: draw a virtual plaster wall behind the shadows. */
  virtualWall: true,
};

/** IoU needed to wake a creature (one-hand shapes; two-hand shapes get 0.06 less). Calibrated in tools/calibrate.ts. */
export const TOLERANCE_IOU: Record<Tolerance, number> = {
  easy: 0.52,
  normal: 0.6,
  expert: 0.7,
};

export function v3set(out: V3 | number[], x: number, y: number, z: number): void {
  out[0] = x;
  out[1] = y;
  out[2] = z;
}
