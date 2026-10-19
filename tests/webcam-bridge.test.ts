import { describe, expect, it } from 'vitest';
import { CREATURE_BY_ID } from '../src/core/creatures.js';
import { J, JOINT_COUNT } from '../src/core/hand-data.js';
import { ShapeMatcher } from '../src/core/match.js';
import { HandShadowBuilder, CANONICAL_HEAD, canonicalStage } from '../src/core/shadow-geom.js';
import { creatureTarget, specJoints } from '../src/core/targets.js';
import { REST_RADII } from '../src/core/hand-model.js';
import { state } from '../src/runtime/state.js';
import { WebcamHands } from '../src/runtime/webcam.js';

// MediaPipe index for each WebXR joint (metacarpals have none)
const XR_FOR_MP = [0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24];

describe('webcam bridge', () => {
  it('turns MediaPipe-shaped landmarks back into the same shadow', () => {
    // head at the canonical origin, like the desktop preview's virtual puppeteer
    state.head = { ...CANONICAL_HEAD, position: [0, 0, 0] };
    const bird = CREATURE_BY_ID.bird;
    const joints = specJoints(bird.hands[0]);
    const w = [joints[0], joints[1], joints[2]];
    const R = [1, 0, 0], U = [0, 1, 0], F = [0, 0, -1];
    const rel = (i: number) => [joints[i * 3] - w[0], joints[i * 3 + 1] - w[1], joints[i * 3 + 2] - w[2]];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // world landmarks in camera axes: x = -right, y = -up, z = -forward
    const world = XR_FOR_MP.map((xi) => {
      const d = rel(xi);
      return { x: -dot(d, R), y: -dot(d, U), z: -dot(d, F), visibility: 1 };
    });
    // image landmarks: wrist position and apparent palm size encode placement
    const px = w[0], py = w[1], pz = -w[2];
    const near = pz - 0.4;
    const palmPx = 0.16 * (1 + near / 0.18);
    const ix = -px / 0.62, iy = -(py + 0.06) / 0.42;
    const img = world.map(() => ({ x: 0.5 + ix, y: 0.5 + iy, z: 0, visibility: 1 }));
    img[9] = { x: 0.5 + ix + palmPx, y: 0.5 + iy, z: 0, visibility: 1 };

    const cam = new WebcamHands();
    (cam as unknown as { writeHand: (s: number, i: unknown, w: unknown, a: number) => void }).writeHand(1, img, world, 1);
    const out = state.hands[1].joints;
    // every MediaPipe-backed joint lands where it started
    for (const xi of XR_FOR_MP) {
      for (let k = 0; k < 3; k++) expect(out[xi * 3 + k]).toBeCloseTo(joints[xi * 3 + k], 3);
    }
    // and the shadow still matches the bird
    const segs = new Float32Array(64 * 8);
    const n = new HandShadowBuilder().build(canonicalStage(), out, REST_RADII, 'right', CANONICAL_HEAD, segs, 0);
    const m = new ShapeMatcher().match(segs, n, creatureTarget(bird))!;
    expect(m.iou).toBeGreaterThan(0.9);
    expect(JOINT_COUNT).toBe(25);
    expect(J.WRIST).toBe(0);
  });
});
