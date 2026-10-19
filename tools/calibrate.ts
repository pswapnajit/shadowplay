// How forgiving is matching? Perturb each creature's pose like a real hand
// would wobble and measure IoU against its own target and the others.
import { CREATURES, type HandSpec } from '../src/core/creatures.js';
import { ShapeMatcher } from '../src/core/match.js';
import { creatureTarget, specSegments } from '../src/core/targets.js';
import { clonePose, rotateFrame, frameFromDirs } from '../src/core/hand-model.js';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const targets = CREATURES.map(creatureTarget);
const m = new ShapeMatcher();

function jitter(spec: HandSpec, amt: number): HandSpec {
  const p = clonePose(spec.pose);
  for (const f of [p.index, p.middle, p.ring, p.pinky]) {
    f.mcp += rnd() * 12 * amt; f.pip += rnd() * 12 * amt; f.dip += rnd() * 8 * amt; f.abd += rnd() * 5 * amt;
  }
  p.thumb.flex += rnd() * 12 * amt; p.thumb.abd += rnd() * 12 * amt; p.thumb.mcp += rnd() * 10 * amt;
  let fr = frameFromDirs(spec.finger, spec.dorsal);
  fr = rotateFrame(fr, [1, 0, 0], rnd() * 0.17 * amt);
  fr = rotateFrame(fr, [0, 1, 0], rnd() * 0.17 * amt);
  fr = rotateFrame(fr, [0, 0, 1], rnd() * 0.17 * amt);
  return {
    ...spec,
    pose: p,
    finger: fr.y,
    dorsal: fr.z,
    wrist: [spec.wrist[0] + rnd() * 0.03 * amt, spec.wrist[1] + rnd() * 0.03 * amt, spec.wrist[2] + rnd() * 0.04 * amt],
  };
}

for (const amt of [0.5, 1.0, 1.5]) {
  console.log(`\n== wobble x${amt} ==   self-IoU (min/median)   best other (max)`);
  for (const c of CREATURES) {
    const self: number[] = [];
    let other = 0; let otherId = '';
    for (let k = 0; k < 24; k++) {
      const { segs, count } = specSegments(c.hands.map((h) => jitter(h, amt)));
      for (const t of targets) {
        const r = m.match(segs, count, t);
        if (!r) continue;
        if (t.id === c.id) self.push(r.iou);
        else if (r.iou > other) { other = r.iou; otherId = t.id; }
      }
    }
    self.sort((a, b) => a - b);
    console.log(`${c.id.padEnd(10)} ${self[0].toFixed(2)} / ${self[12].toFixed(2)}        ${other.toFixed(2)} (${otherId})`);
  }
}
