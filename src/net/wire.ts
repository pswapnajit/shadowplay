/**
 * What the two players send each other, about twenty times a second.
 *
 * Shadows travel as 2D capsules on the wall (wall metres, quantised to an
 * eighth of a millimetre in 16 bits), so a pair of hands is about a
 * kilobyte. The host also sends the stage: every creature's shadow and the
 * wall's lighting. The guest's tracked joints never leave its device; only
 * how straight each finger is goes with its shadow, so the host can tell
 * an open hand from a rabbit.
 */

import { SEG_STRIDE } from '../core/shadow-geom.js';

export const HOST_FRAME = 1;
export const GUEST_FRAME = 2;
/** Wall uniforms the host mirrors to the guest, in this order. */
export const STAGE_FLOATS = 29;
const Q = 8000;
const HOST_HEAD = 8;
const GUEST_HEAD = 4 + 8 * 4;

function putSegs(view: Int16Array, at: number, segs: Float32Array, count: number): void {
  for (let i = 0; i < count; i++) {
    const o = i * SEG_STRIDE;
    const w = at + i * 6;
    view[w] = Math.round(segs[o] * Q);
    view[w + 1] = Math.round(segs[o + 1] * Q);
    view[w + 2] = Math.round(segs[o + 2] * Q);
    view[w + 3] = Math.round(segs[o + 4] * Q);
    view[w + 4] = Math.round(segs[o + 5] * Q);
    view[w + 5] = Math.round(segs[o + 6] * Q);
  }
}

function getSegs(view: Int16Array, at: number, count: number, out: Float32Array, max: number): number {
  const n = Math.min(count, max);
  for (let i = 0; i < n; i++) {
    const o = i * SEG_STRIDE;
    const r = at + i * 6;
    out[o] = view[r] / Q;
    out[o + 1] = view[r + 1] / Q;
    out[o + 2] = view[r + 2] / Q;
    out[o + 3] = 0;
    out[o + 4] = view[r + 3] / Q;
    out[o + 5] = view[r + 4] / Q;
    out[o + 6] = view[r + 5] / Q;
    out[o + 7] = 0;
  }
  return n;
}

/** The host's frame: the stage's lighting, every creature's shadow (with its opacity), and the host's own hands. */
export function encodeHostFrame(
  stage: Float32Array,
  creatures: Float32Array,
  alphas: Float32Array,
  creatureCount: number,
  hands: Float32Array,
  handCount: number,
): ArrayBuffer {
  const segBytes = (creatureCount + handCount) * 12;
  const buf = new ArrayBuffer(HOST_HEAD + STAGE_FLOATS * 4 + segBytes + creatureCount);
  const dv = new DataView(buf);
  dv.setUint8(0, HOST_FRAME);
  dv.setUint16(2, creatureCount, true);
  dv.setUint16(4, handCount, true);
  new Float32Array(buf, HOST_HEAD, STAGE_FLOATS).set(stage.subarray(0, STAGE_FLOATS));
  const segAt = HOST_HEAD + STAGE_FLOATS * 4;
  const segView = new Int16Array(buf, segAt, (creatureCount + handCount) * 6);
  putSegs(segView, 0, creatures, creatureCount);
  putSegs(segView, creatureCount * 6, hands, handCount);
  const a = new Uint8Array(buf, segAt + segBytes, creatureCount);
  for (let i = 0; i < creatureCount; i++) a[i] = Math.round(Math.max(0, Math.min(1, alphas[i])) * 255);
  return buf;
}

export interface HostFrameOut {
  stage: Float32Array;
  creatures: Float32Array;
  alphas: Float32Array;
  creatureCount: number;
  hands: Float32Array;
  handCount: number;
}

export function decodeHostFrame(buf: ArrayBuffer, out: HostFrameOut): boolean {
  const dv = new DataView(buf);
  if (buf.byteLength < HOST_HEAD + STAGE_FLOATS * 4 || dv.getUint8(0) !== HOST_FRAME) return false;
  const nc = dv.getUint16(2, true);
  const nh = dv.getUint16(4, true);
  const segAt = HOST_HEAD + STAGE_FLOATS * 4;
  if (buf.byteLength < segAt + (nc + nh) * 12 + nc) return false;
  out.stage.set(new Float32Array(buf, HOST_HEAD, STAGE_FLOATS));
  const segView = new Int16Array(buf, segAt, (nc + nh) * 6);
  out.creatureCount = getSegs(segView, 0, nc, out.creatures, out.alphas.length);
  out.handCount = getSegs(segView, nc * 6, nh, out.hands, out.hands.length / SEG_STRIDE);
  const a = new Uint8Array(buf, segAt + (nc + nh) * 12, nc);
  for (let i = 0; i < out.creatureCount; i++) out.alphas[i] = a[i] / 255;
  return true;
}

/** The guest's frame: its hands' shadows, which hands are tracked, and how straight each long finger is (left 4, right 4). */
export function encodeGuestFrame(hands: Float32Array, handCount: number, tracked: number, straight: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(GUEST_HEAD + handCount * 12);
  const dv = new DataView(buf);
  dv.setUint8(0, GUEST_FRAME);
  dv.setUint8(1, tracked);
  dv.setUint16(2, handCount, true);
  new Float32Array(buf, 4, 8).set(straight.subarray(0, 8));
  putSegs(new Int16Array(buf, GUEST_HEAD, handCount * 6), 0, hands, handCount);
  return buf;
}

export interface GuestFrameOut {
  hands: Float32Array;
  handCount: number;
  tracked: number;
  straight: Float32Array;
}

export function decodeGuestFrame(buf: ArrayBuffer, out: GuestFrameOut): boolean {
  const dv = new DataView(buf);
  if (buf.byteLength < GUEST_HEAD || dv.getUint8(0) !== GUEST_FRAME) return false;
  const n = dv.getUint16(2, true);
  if (buf.byteLength < GUEST_HEAD + n * 12) return false;
  out.tracked = dv.getUint8(1);
  out.straight.set(new Float32Array(buf, 4, 8));
  out.handCount = getSegs(new Int16Array(buf, GUEST_HEAD, n * 6), 0, n, out.hands, out.hands.length / SEG_STRIDE);
  return true;
}

/** A line of wall text: [text, sub, shown]. */
export type TextState = [string, string, boolean];
/** The narration: [line, words shown, thinking, shown, the line's signature (for the voice)]. */
export type LineState = [string, number, boolean, boolean, string];

/** The host's scene, sent whenever it changes: the words on the wall and the outline to make. */
export interface Scene {
  t: 'scene';
  title: TextState;
  caption: TextState;
  /** Where the caption sits (it moves up while a story asks). */
  captionY: number;
  line: LineState;
  /** The creature whose outline is on the wall, or null. */
  target: string | null;
}

export type HostEvent = Scene | { t: 'sfx'; m: string; a: unknown[] } | { t: 'hello'; v: 1 };
export type GuestEvent = { t: 'hello'; v: 1 };
