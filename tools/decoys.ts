// Decoy calibration: a hand that isn't making anything (open, relaxed, fist)
// must never wake a creature, and real creature shapes (with natural wobble)
// must still clearly beat every decoy. Prints both sides of that trade-off.
//   npx tsx tools/decoys.ts
import { CREATURES, type HandSpec } from '../src/core/creatures.js';
import { ShapeMatcher } from '../src/core/match.js';
import { clonePose, frameFromDirs, rotateFrame } from '../src/core/hand-model.js';
import { creatureTarget, DECOYS, decoyTargets, specSegments } from '../src/core/targets.js';

const m = new ShapeMatcher();
const creatures = CREATURES.map(creatureTarget);
const decoys = decoyTargets();

console.log('decoy vs creatures (a decoy must stay below the wake threshold, 0.52 easy / 0.6 normal):');
for (const d of DECOYS) {
  const { segs, count } = specSegments(d.hands);
  const rows = creatures.map((t) => ({ id: t.id, v: m.match(segs, count, t)?.iou ?? 0 })).sort((a, b) => b.v - a.v);
  console.log(`  ${d.id.padEnd(9)} ${rows.slice(0, 3).map((r) => `${r.id} ${r.v.toFixed(2)}`).join('  ')}`);
}

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
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
  return { ...spec, pose: p, finger: fr.y, dorsal: fr.z, wrist: [spec.wrist[0] + rnd() * 0.03 * amt, spec.wrist[1] + rnd() * 0.03 * amt, spec.wrist[2] + rnd() * 0.04 * amt] };
}

for (const amt of [1, 1.5]) {
  console.log(`\nwobble x${amt}: self IoU vs best decoy, and how often the margin is under 0 / 0.02 (of 40)`);
  for (const c of CREATURES) {
    const target = creatures.find((t) => t.id === c.id)!;
    let under5 = 0;
    let under8 = 0;
    let minMargin = 1;
    let worst = '';
    for (let k = 0; k < 40; k++) {
      const { segs, count } = specSegments(c.hands.map((h) => jitter(h, amt)));
      const self = m.match(segs, count, target)?.iou ?? 0;
      let dmax = 0;
      let did = '';
      for (const d of decoys) {
        const v = m.match(segs, count, d)?.iou ?? 0;
        if (v > dmax) [dmax, did] = [v, d.id];
      }
      if (self < 0.55) continue; // would not have woken anyway
      const margin = self - dmax;
      if (margin < 0.0) under5++;
      if (margin < 0.02) under8++;
      if (margin < minMargin) [minMargin, worst] = [margin, did];
    }
    console.log(`  ${c.id.padEnd(10)} under 0: ${String(under5).padStart(2)}  under 0.02: ${String(under8).padStart(2)}  worst margin ${minMargin.toFixed(2)} (${worst})`);
  }
}
