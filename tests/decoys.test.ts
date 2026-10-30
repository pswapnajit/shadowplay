import { describe, expect, it } from 'vitest';
import { CREATURES } from '../src/core/creatures.js';
import { OPEN_HAND } from '../src/core/hand-model.js';
import { ShapeMatcher } from '../src/core/match.js';
import { fingerShape, fingersFit } from '../src/core/fingers.js';
import type { HandSpec } from '../src/core/creatures.js';
import { creatureTarget, DECOYS, decoyTargets, specJoints, specSegments } from '../src/core/targets.js';

const m = new ShapeMatcher();
const creatures = CREATURES.map(creatureTarget);
const decoys = decoyTargets();
const targets = [...creatures, ...decoys];

const shapes = new Map(CREATURES.filter((c) => c.hands.length === 1).map((c) => [c.id, fingerShape(specJoints(c.hands[0]))]));

/**
 * The rules the game applies: a creature must beat every decoy (the taught
 * one gets 0.05 of leeway), and a shape made with curled fingers needs them curled.
 */
function wakes(hands: HandSpec[], taught: boolean): string[] {
  const { segs, count } = specSegments(hands);
  const r = m.matchAll(segs, count, targets)!;
  const decoy = Math.max(...decoys.map((_, i) => r[creatures.length + i].iou));
  const joints = hands.map((h) => specJoints(h));
  return creatures
    .filter((t, i) => {
      const need = shapes.get(t.id);
      const fits = !need || joints.some((j) => fingersFit(need, j));
      return fits && r[i].iou >= 0.52 && r[i].iou > decoy - (taught ? 0.05 : 0);
    })
    .map((t) => t.id);
}

describe('decoys', () => {
  it('every creature, made properly, beats every resting hand', () => {
    for (const c of CREATURES) expect(wakes(c.hands, false), c.id).toContain(c.id);
  });

  it('a hand raised into the light, open or tilted, wakes nobody', () => {
    for (const finger of [[0, 1, -0.2], [-0.3, 1, -0.3], [-0.5, 0.8, -0.2], [0.2, 1, -0.4]] as [number, number, number][]) {
      for (const wrist of [[0.1, -0.1, -0.42], [0.07, -0.14, -0.38], [0, -0.05, -0.3]] as [number, number, number][]) {
        expect(wakes([{ side: 'right', pose: OPEN_HAND, finger, dorsal: [0, 0.2, 1], wrist }], true), `${finger} ${wrist}`).toEqual([]);
      }
    }
  });

  it('a fist or a relaxed hand is never a creature', () => {
    for (const pose of ['fist', 'relaxed']) {
      const hands = (DECOYS.find((d) => d.id === pose)!).hands;
      expect(wakes(hands, true), pose).toEqual([]);
    }
  });

  it('matchAll agrees with matching one target at a time', () => {
    const { segs, count } = specSegments(CREATURES[3].hands);
    const all = m.matchAll(segs, count, targets)!.map((r) => r.iou);
    targets.forEach((t, i) => expect(all[i]).toBeCloseTo(m.match(segs, count, t)!.iou, 6));
  });
});
