/**
 * Turns authored hand placements into shadow segments and match targets.
 */

import type { CreatureDef, HandSpec } from './creatures.js';
import { BONES_PER_HAND, JOINT_COUNT } from './hand-data.js';
import { type HandPose, OPEN_HAND, REST_RADII, frameFromDirs, placeJoints, poseJointsPalm } from './hand-model.js';
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

const curled = (mcp: number, pip: number, dip: number): HandPose => ({
  thumb: { flex: 20, abd: 25, mcp: 20, ip: 20 },
  index: { mcp, pip, dip, abd: 4 },
  middle: { mcp, pip, dip, abd: 0 },
  ring: { mcp, pip, dip, abd: 4 },
  pinky: { mcp, pip, dip, abd: 8 },
});
const raised = (pose: HandPose, finger: [number, number, number] = [-0.15, 1, -0.25]): HandSpec => ({
  side: 'right',
  pose,
  finger,
  dorsal: [0, 0.2, 1],
  wrist: [0.07, -0.14, -0.38],
});

/**
 * Hands that aren't making anything: what a player holds up while waiting,
 * thinking or reaching for a shape. A creature only wakes if it clearly beats
 * all of these (see tools/decoys.ts for the calibration).
 */
export const DECOYS: { id: string; hands: HandSpec[] }[] = [
  { id: 'open', hands: [raised(OPEN_HAND)] },
  { id: 'relaxed', hands: [raised(curled(25, 35, 15))] },
  { id: 'fist', hands: [raised(curled(85, 100, 50))] },
  { id: 'tilted', hands: [raised(OPEN_HAND, [-0.7, 0.7, -0.25])] },
];

export function decoyTargets(): Target[] {
  return DECOYS.map((d) => {
    const { segs, count } = specSegments(d.hands);
    return makeTarget(`decoy:${d.id}`, segs, count);
  });
}
