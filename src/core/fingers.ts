/**
 * Finger straightness from tracked joints. Shadows alone can't always tell
 * an open hand from a rabbit (both are a palm with fingers up), but the
 * joints can: the rabbit's ring and little fingers are curled.
 */

import { J } from './hand-data.js';

const CHAINS = [
  [J.INDEX_PP, J.INDEX_IP, J.INDEX_DP, J.INDEX_TIP],
  [J.MIDDLE_PP, J.MIDDLE_IP, J.MIDDLE_DP, J.MIDDLE_TIP],
  [J.RING_PP, J.RING_IP, J.RING_DP, J.RING_TIP],
  [J.PINKY_PP, J.PINKY_IP, J.PINKY_DP, J.PINKY_TIP],
] as const;

const d = (j: Float32Array, a: number, b: number) =>
  Math.hypot(j[a * 3] - j[b * 3], j[a * 3 + 1] - j[b * 3 + 1], j[a * 3 + 2] - j[b * 3 + 2]);

/** Per long finger (index, middle, ring, little): 1 when straight, about 0.5 when curled. */
export function straightness(joints: Float32Array, out = new Float32Array(4)): Float32Array {
  CHAINS.forEach(([pp, ip, dp, tip], i) => {
    const len = d(joints, pp, ip) + d(joints, ip, dp) + d(joints, dp, tip);
    out[i] = len > 1e-6 ? d(joints, pp, tip) / len : 1;
  });
  return out;
}

/** What a one-handed shape needs of each long finger: -1 curled, +1 straight (read from its canonical pose). */
export function fingerShape(joints: Float32Array): number[] {
  return [...straightness(joints)].map((s) => (s < 0.8 ? -1 : s > 0.95 ? 1 : 0));
}

const tmp = new Float32Array(4);
/** False when this hand plainly contradicts the shape: a finger it needs curled is straight, or one it needs straight is curled. */
export function fingersFit(shape: readonly number[], joints: Float32Array): boolean {
  return straightnessFits(shape, straightness(joints, tmp));
}

/** The same test on straightness already measured (a friend's hand, measured on their device): `s[at..at+3]`. */
export function straightnessFits(shape: readonly number[], s: ArrayLike<number>, at = 0): boolean {
  for (let i = 0; i < 4; i++) {
    if (shape[i] < 0 && s[at + i] > 0.9) return false;
    if (shape[i] > 0 && s[at + i] < 0.6) return false;
  }
  return true;
}
