// Renders each creature's shadow + hand skeleton views to PNG for review.
// Usage: npx tsx tools/render-poses.ts [creatureId...]
import { CREATURES, type HandSpec } from '../src/core/creatures.js';
import { J, JOINT_COUNT, SHADOW_BONES } from '../src/core/hand-data.js';
import { Grid, rasterize, segmentBounds } from '../src/core/raster.js';
import { specJoints, specSegments } from '../src/core/targets.js';
import { Canvas } from './png.js';

const OUT = new URL('./out/', import.meta.url).pathname;
const P = 300;

type RGB = [number, number, number];
const FINGER_COLOR = (j: number): RGB => {
  if (j === 0) return [60, 60, 60];
  if (j <= J.THUMB_TIP) return [220, 50, 50];
  if (j <= J.INDEX_TIP) return [235, 140, 20];
  if (j <= J.MIDDLE_TIP) return [40, 160, 60];
  if (j <= J.RING_TIP) return [40, 90, 220];
  return [150, 60, 200];
};

function drawShadow(cv: Canvas, ox: number, specs: HandSpec[], label: string): void {
  const { segs, count } = specSegments(specs);
  const b = segmentBounds(segs, count, new Float32Array(4));
  const size = Math.max(b[2] - b[0], b[3] - b[1]) * 1.15;
  const g = Grid.centred(P, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, size);
  rasterize(segs, count, g, true);
  for (let j = 0; j < P; j++)
    for (let i = 0; i < P; i++) {
      const c = g.data[j * P + i];
      // flip y: grid row 0 is the bottom of the wall
      cv.blend(ox + i, P - 1 - j, [25, 18, 12], c * 0.92);
    }
  cv.line(ox, 0, ox, P - 1, [180, 160, 130], 1);
  void label;
}

function drawSkeleton(cv: Canvas, ox: number, specs: HandSpec[], view: 'front' | 'side'): void {
  const all: Float32Array[] = specs.map((s) => specJoints(s));
  let minA = Infinity;
  let maxA = -Infinity;
  let minB = Infinity;
  let maxB = -Infinity;
  const ab = (p: Float32Array, i: number): [number, number] =>
    view === 'front' ? [p[i * 3], p[i * 3 + 1]] : [-p[i * 3 + 2], p[i * 3 + 1]];
  for (const p of all)
    for (let i = 0; i < JOINT_COUNT; i++) {
      const [a, b] = ab(p, i);
      minA = Math.min(minA, a);
      maxA = Math.max(maxA, a);
      minB = Math.min(minB, b);
      maxB = Math.max(maxB, b);
    }
  const size = Math.max(maxA - minA, maxB - minB) * 1.25;
  const ca = (minA + maxA) / 2;
  const cb = (minB + maxB) / 2;
  const toPx = (a: number, b: number): [number, number] => [
    ox + ((a - ca) / size + 0.5) * P,
    P - ((b - cb) / size + 0.5) * P,
  ];
  for (const p of all) {
    for (const [ia, ib] of SHADOW_BONES) {
      const [x0, y0] = toPx(...ab(p, ia));
      const [x1, y1] = toPx(...ab(p, ib));
      cv.line(x0, y0, x1, y1, [170, 170, 170], 2);
    }
    for (let i = 0; i < JOINT_COUNT; i++) {
      const [x, y] = toPx(...ab(p, i));
      cv.disc(x, y, 3.5, FINGER_COLOR(i));
    }
  }
  cv.line(ox, 0, ox, P - 1, [180, 160, 130], 1);
}

const ids = process.argv.slice(2);
for (const c of CREATURES) {
  if (ids.length && !ids.includes(c.id)) continue;
  const rows = c.alt ? 2 : 1;
  const cv = new Canvas(P * 3, P * rows, [246, 236, 214]);
  const variants = [c.hands, ...(c.alt ? [c.alt] : [])];
  variants.forEach((specs, r) => {
    const sub = new Canvas(P * 3, P, [246, 236, 214]);
    drawShadow(sub, 0, specs, c.name);
    drawSkeleton(sub, P, specs, 'front');
    drawSkeleton(sub, P * 2, specs, 'side');
    cv.px.set(sub.px, r * P * 3 * P * 4);
  });
  cv.save(`${OUT}${c.id}.png`);
  console.log('wrote', `${OUT}${c.id}.png`);
}

// Contact sheet: shadows only, every creature and alt pose.
{
  const panels: HandSpec[][] = [];
  const names: string[] = [];
  for (const c of CREATURES) {
    panels.push(c.hands);
    names.push(c.id);
    if (c.alt) {
      panels.push(c.alt);
      names.push(c.id + '-alt');
    }
  }
  const cols = 4;
  const rowsN = Math.ceil(panels.length / cols);
  const sheet = new Canvas(P * cols, P * rowsN, [246, 236, 214]);
  panels.forEach((specs, k) => {
    const sub = new Canvas(P, P, [246, 236, 214]);
    drawShadow(sub, 0, specs, names[k]);
    const ox = (k % cols) * P;
    const oy = Math.floor(k / cols) * P;
    for (let y = 0; y < P; y++)
      sheet.px.set(sub.px.subarray(y * P * 4, (y + 1) * P * 4), ((oy + y) * P * cols + ox) * 4);
  });
  sheet.save(`${OUT}sheet.png`);
  console.log('sheet:', names.join(', '));
}
