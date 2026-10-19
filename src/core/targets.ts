/**
 * Turns authored hand placements into shadow segments and match targets.
 */

import type { CreatureDef, HandSpec } from './creatures.js';
import { BONES_PER_HAND, JOINT_COUNT } from './hand-data.js';
import { REST_RADII, frameFromDirs, placeJoints, poseJointsPalm } from './hand-model.js';
import { makeTarget, type Target } from './match.js';
import { CANONICAL_HEAD, HandShadowBuilder, type HeadFrame, SEG_STRIDE, type Stage, canonicalStage } from './shadow-geom.js';

const palm = new Float32Array(JOINT_COUNT * 3);

export function specJoints(spec: HandSpec, out = new Float32Array(JOINT_COUNT * 3)): Float32Array {
  poseJointsPalm(spec.pose, palm);
  return placeJoints(palm, spec.side, frameFromDirs(spec.finger, spec.dorsal), spec.wrist, out);
}

const builder = new HandShadowBuilder();

/** Shadow segments for a set of hands. Returns the segment count. */
export function specSegments(
  specs: HandSpec[],
  stage: Stage = canonicalStage(),
  head: HeadFrame = CANONICAL_HEAD,
  out = new Float32Array(specs.length * BONES_PER_HAND * SEG_STRIDE),
): { segs: Float32Array; count: number } {
  let count = 0;
  const joints = new Float32Array(JOINT_COUNT * 3);
  for (const spec of specs) {
    specJoints(spec, joints);
    count += builder.build(stage, joints, REST_RADII, spec.side, head, out, count);
  }
  return { segs: out, count };
}

export function creatureTarget(c: CreatureDef): Target {
  const { segs, count } = specSegments(c.hands);
  return makeTarget(c.id, segs, count);
}
