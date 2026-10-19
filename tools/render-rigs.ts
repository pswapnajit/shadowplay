// Renders animation frames of each creature rig to a contact sheet.
import { RIGS, SegWriter } from '../src/core/rigs.js';
import { Grid, rasterize } from '../src/core/raster.js';
import { Canvas } from './png.js';

const OUT = new URL('./out/', import.meta.url).pathname;
const P = 220;
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(RIGS);
const frames = [0, 0.11, 0.23, 0.37];
const sheet = new Canvas(P * frames.length, P * names.length, [246, 236, 214]);
const segs = new Float32Array(400 * 8);
const alphas = new Float32Array(400);
names.forEach((name, r) => {
  frames.forEach((t, c) => {
    const w = new SegWriter(segs, alphas).begin(0, 0, 1, 1, 1);
    RIGS[name](w, t, c === 3 ? 1 : 0);
    const g = Grid.centred(P, 0, 0.12, 0.62);
    rasterize(segs, w.n, g, false);
    for (let j = 0; j < P; j++)
      for (let i = 0; i < P; i++) sheet.blend(c * P + i, r * P + (P - 1 - j), [25, 18, 12], g.data[j * P + i] * 0.95);
  });
});
sheet.save(`${OUT}rigs.png`);
console.log('rows:', names.join(', '));
