import { describe, expect, it } from 'vitest';
import { CREATURES } from '../src/core/creatures.js';
import { ShapeMatcher } from '../src/core/match.js';
import { RIG_HEIGHT, RIGS, SegWriter } from '../src/core/rigs.js';
import { creatureTarget, specSegments } from '../src/core/targets.js';

describe('creatures', () => {
  const targets = new Map(CREATURES.map((c) => [c.id, creatureTarget(c)]));
  const matcher = new ShapeMatcher();

  it.each(CREATURES.map((c) => [c.id, c] as const))('%s has a rig, a size and a song', (_id, c) => {
    expect(RIGS[c.id]).toBeTypeOf('function');
    expect(RIG_HEIGHT[c.id]).toBeGreaterThan(0);
    expect(c.song.length).toBeGreaterThan(2);
    const w = new SegWriter(new Float32Array(400 * 8), new Float32Array(400)).begin(0, 0, 1, 1, 1);
    RIGS[c.id](w, 0.37, 1);
    expect(w.n).toBeGreaterThan(5);
  });

  it.each(CREATURES.map((c) => [c.id, c] as const))('%s: its own pose matches its target', (_id, c) => {
    const { segs, count } = specSegments(c.hands);
    const r = matcher.match(segs, count, targets.get(c.id)!)!;
    expect(r.iou).toBeGreaterThan(0.95);
  });

  it('mirrored poses (other hand / lamp on the left) still match', () => {
    for (const c of CREATURES) {
      const { segs, count } = specSegments(c.hands);
      // mirror the shadow left-right in wall space
      for (let i = 0; i < count; i++) {
        segs[i * 8] *= -1;
        segs[i * 8 + 4] *= -1;
      }
      expect(matcher.match(segs, count, targets.get(c.id)!)!.iou).toBeGreaterThan(0.9);
    }
  });
});
