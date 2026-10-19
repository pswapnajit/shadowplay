/**
 * Synthetic hands for the desktop preview, automated tests and the
 * "show me" ghost: poses authored in the canonical head frame are placed
 * relative to the player's (levelled) head, exactly where the targets were
 * authored, so their shadows land as designed.
 */

import { createSystem } from '@iwsdk/core';
import type { CreatureDef, HandSpec } from '../core/creatures.js';
import { JOINT_COUNT, type V3 } from '../core/hand-data.js';
import { REST_RADII, frameFromDirs, lerpPose, placeJoints, poseJointsPalm } from '../core/hand-model.js';
import { externalHands } from './theatre.js';
import { state } from './state.js';

const palm = new Float32Array(JOINT_COUNT * 3);

/** Head-frame (canonical) → world, using a levelled version of the live head. */
export function headToWorld(p: V3, out: V3, isDirection = false): V3 {
  const H = state.head.position;
  let fx = state.head.forward[0];
  let fz = state.head.forward[2];
  const fl = Math.hypot(fx, fz) || 1;
  fx /= fl;
  fz /= fl;
  // canonical: x right, y up, -z forward
  const rx = -fz;
  const rz = fx;
  const x = p[0];
  const y = p[1];
  const z = -p[2];
  out[0] = rx * x + fx * z + (isDirection ? 0 : H[0]);
  out[1] = y + (isDirection ? 0 : H[1]);
  out[2] = rz * x + fz * z + (isDirection ? 0 : H[2]);
  return out;
}

const wv: V3 = [0, 0, 0];
const fv: V3 = [0, 0, 0];
const dv: V3 = [0, 0, 0];

/** Writes a hand spec (optionally blended towards another) into world-space joints. */
export function placeSpec(spec: HandSpec, joints: Float32Array, blendTo?: HandSpec, t = 0): void {
  const pose = blendTo ? lerpPose(spec.pose, blendTo.pose, t) : spec.pose;
  poseJointsPalm(pose, palm);
  const wrist = blendTo ? lerp3(spec.wrist, blendTo.wrist, t) : spec.wrist;
  const finger = blendTo ? lerp3(spec.finger, blendTo.finger, t) : spec.finger;
  const dorsal = blendTo ? lerp3(spec.dorsal, blendTo.dorsal, t) : spec.dorsal;
  headToWorld(wrist, wv);
  headToWorld(finger, fv, true);
  headToWorld(dorsal, dv, true);
  placeJoints(palm, spec.side, frameFromDirs(fv, dv), wv, joints);
}

function lerp3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Plays creature poses on the player's hands (desktop preview / attract mode).
 * Enabled with `?demo` in the URL, or by other systems via `perform()`.
 */
export class DemoHandsSystem extends createSystem({}) {
  private creature: CreatureDef | null = null;
  private t = 0;
  enabled = false;

  perform(c: CreatureDef | null): void {
    this.creature = c;
    this.t = 0;
    this.enabled = c !== null;
    externalHands.active = this.enabled;
    if (!this.enabled) {
      state.hands[0].tracked = false;
      state.hands[1].tracked = false;
    }
  }

  update(delta: number): void {
    if (!this.enabled || !this.creature) return;
    this.t += delta;
    const c = this.creature;
    state.hands[0].tracked = false;
    state.hands[1].tracked = false;
    // Breathe between the main and alt pose so mouths open and close.
    const k = c.alt ? 0.5 - 0.5 * Math.cos(this.t * 2.4) : 0;
    c.hands.forEach((spec, i) => {
      const out = spec.side === 'left' ? state.hands[0] : state.hands[1];
      placeSpec(spec, out.joints, c.alt?.[i], k);
      // tiny idle sway so the shadow feels alive
      const sway = Math.sin(this.t * 1.3 + i) * 0.004;
      for (let j = 0; j < JOINT_COUNT; j++) out.joints[j * 3 + 1] += sway;
      out.radii.set(REST_RADII);
      out.tracked = true;
    });
    state.handSource = 'demo';
  }
}
