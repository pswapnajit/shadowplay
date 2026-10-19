/**
 * The shadow creatures: how to make each one with your hands, and what it
 * does when it wakes up. Hand placements are in the canonical head frame
 * (head at origin, x right, y up, looking down -z), see shadow-geom.ts.
 */

import type { V3 } from './hand-data.js';
import { type HandPose, OPEN_HAND, type Side, clonePose, v3 } from './hand-model.js';
import { canonicalStage } from './shadow-geom.js';

export interface HandSpec {
  side: Side;
  pose: HandPose;
  /** Direction the fingers point (palm frame +y). */
  finger: V3;
  /** Direction the back of the hand faces (palm frame +z). */
  dorsal: V3;
  /** Wrist joint position. */
  wrist: V3;
}

export type Motion = 'chatter' | 'hop' | 'trot' | 'glide' | 'snap' | 'flutter';

export interface CreatureDef {
  id: string;
  name: string;
  /** One-line teaching hint, shown only if the player asks. */
  hint: string;
  hands: HandSpec[];
  /** Optional second pose (e.g. mouth open) used for the ghost-hand demo. */
  alt?: HandSpec[];
  motion: Motion;
  /** Pentatonic scale degrees for the creature's song. */
  song: number[];
  difficulty: 1 | 2 | 3;
}

const STAGE = canonicalStage('right');
const rayAt = (wrist: V3): V3 => v3.norm(v3.sub(wrist, STAGE.lamp));
const perp = (hint: V3, r: V3): V3 => v3.norm(v3.sub(hint, v3.scale(r, v3.dot(hint, r))));

/**
 * A hand seen edge-on by the lamp: its fingers stack along the light ray,
 * so the shadow is the hand's side profile (beaks, heads, jaws).
 */
function profile(side: Side, wrist: V3, fingerHint: V3, dorsalHint: V3, pose: HandPose): HandSpec {
  const r = rayAt(wrist);
  const finger = perp(fingerHint, r);
  let dorsal = v3.cross(r, finger);
  if (v3.dot(dorsal, dorsalHint) < 0) dorsal = v3.scale(dorsal, -1);
  return { side, pose, finger, dorsal, wrist };
}

/** A hand held flat to the light, so the whole outline shows (ears, wings, thumbs). */
function flat(side: Side, wrist: V3, fingerHint: V3, palmFaces: 'lamp' | 'wall', pose: HandPose): HandSpec {
  const r = rayAt(wrist);
  const finger = perp(fingerHint, r);
  const dorsal = palmFaces === 'lamp' ? r : v3.scale(r, -1);
  return { side, pose, finger, dorsal, wrist };
}

const pose = (f: (p: HandPose) => void): HandPose => {
  const p = clonePose(OPEN_HAND);
  f(p);
  return p;
};

const together = (p: HandPose) => {
  p.index.abd = 0;
  p.middle.abd = 0;
  p.ring.abd = 0;
  p.pinky.abd = 0;
};

// --- chatterbird: the beak is your thumb and fingers -----------------------
const birdClosed = pose((p) => {
  together(p);
  for (const f of [p.index, p.middle, p.ring, p.pinky]) f.mcp = 6;
  p.thumb = { flex: 10, abd: -15, mcp: 0, ip: 0 };
});
const birdOpen = pose((p) => {
  together(p);
  p.thumb = { flex: 0, abd: 45, mcp: 0, ip: 0 };
});

// --- rabbit: two fingers up as ears ----------------------------------------
const rabbit = pose((p) => {
  p.index = { mcp: 0, pip: 0, dip: 0, abd: 8 };
  p.middle = { mcp: 0, pip: 0, dip: 0, abd: 8 };
  p.ring = { mcp: 85, pip: 100, dip: 60, abd: 0 };
  p.pinky = { mcp: 85, pip: 100, dip: 60, abd: 0 };
  p.thumb = { flex: 45, abd: 35, mcp: 25, ip: 20 };
});

// --- dog: thumb up for an ear, little finger drops for the jaw --------------
const dogClosed = pose((p) => {
  together(p);
  p.pinky = { mcp: 8, pip: 0, dip: 0, abd: 4 };
  p.thumb = { flex: -45, abd: 0, mcp: 0, ip: 0 };
});
const dogOpen = pose((p) => {
  together(p);
  p.pinky = { mcp: 20, pip: 0, dip: 0, abd: 28 };
  p.thumb = { flex: -45, abd: 0, mcp: 0, ip: 0 };
});

// --- swan: your forearm is the neck, your bent hand the head ----------------
const swan = pose((p) => {
  together(p);
  for (const f of [p.index, p.middle, p.ring, p.pinky]) {
    f.mcp = 10;
    f.pip = 8;
  }
  p.thumb = { flex: 20, abd: 10, mcp: 10, ip: 5 };
});

// --- crocodile: two flat hands are the jaws ---------------------------------
const jaw = pose((p) => {
  together(p);
  p.thumb = { flex: 25, abd: -5, mcp: 5, ip: 0 };
});

// --- butterfly: thumbs hooked, fingers spread as wings ----------------------
const wing = pose((p) => {
  p.index.abd = 14;
  p.middle.abd = 4;
  p.ring.abd = 12;
  p.pinky.abd = 22;
  p.thumb = { flex: -35, abd: 5, mcp: 25, ip: 35 };
});

export const CREATURES: CreatureDef[] = [
  {
    id: 'bird',
    name: 'Chatterbird',
    hint: 'Hand on its side, fingers together on top, thumb underneath. Open and close the beak.',
    hands: [profile('right', [0.06, -0.08, -0.4], [-1, 0, 0], [0, 1, 0], birdClosed)],
    alt: [profile('right', [0.06, -0.08, -0.4], [-1, 0, 0], [0, 1, 0], birdOpen)],
    motion: 'chatter',
    song: [0, 2, 4, 2, 0, 4],
    difficulty: 1,
  },
  {
    id: 'rabbit',
    name: 'Rabbit',
    hint: 'Make a loose fist, then lift two fingers into a V for the ears.',
    hands: [flat('right', [0.0, -0.16, -0.4], [0.1, 1, 0], 'wall', rabbit)],
    motion: 'hop',
    song: [4, 5, 7, 5, 4, 2],
    difficulty: 1,
  },
  {
    id: 'dog',
    name: 'Dog',
    hint: 'Palm towards you, fingers pointing across. Thumb up is the ear; drop your little finger to bark.',
    hands: [flat('right', [0.06, -0.08, -0.4], [-1, 0, 0], 'lamp', dogClosed)],
    alt: [flat('right', [0.06, -0.08, -0.4], [-1, 0, 0], 'lamp', dogOpen)],
    motion: 'trot',
    song: [0, 0, 4, 5, 4, 2],
    difficulty: 2,
  },
  {
    id: 'swan',
    name: 'Swan',
    hint: 'Raise your forearm, then bend your hand forward so the fingers point down like a beak.',
    hands: [profile('right', [0.04, 0.02, -0.42], [-0.6, -0.8, 0], [-0.8, 0.6, 0], swan)],
    motion: 'glide',
    song: [7, 5, 4, 2, 4, 0],
    difficulty: 2,
  },
  {
    id: 'crocodile',
    name: 'Crocodile',
    hint: 'Both hands flat, one on top of the other, fingers pointing across. Open your wrists to snap.',
    hands: [
      profile('right', [0.08, -0.07, -0.4], [-1, 0.15, 0], [0, 1, 0], jaw),
      profile('left', [0.08, -0.115, -0.4], [-1, -0.1, 0], [0, -1, 0], jaw),
    ],
    motion: 'snap',
    song: [0, 1, 0, 4, 3, 0],
    difficulty: 3,
  },
  {
    id: 'butterfly',
    name: 'Butterfly',
    hint: 'Cross your wrists, hook your thumbs together and spread your fingers wide. Flap!',
    hands: [
      flat('right', [0.03, -0.17, -0.4], [-0.5, 0.85, 0], 'lamp', wing),
      flat('left', [-0.03, -0.17, -0.38], [0.5, 0.85, 0], 'lamp', wing),
    ],
    motion: 'flutter',
    song: [4, 7, 9, 7, 4, 7],
    difficulty: 3,
  },
];

export const CREATURE_BY_ID: Record<string, CreatureDef> = Object.fromEntries(
  CREATURES.map((c) => [c.id, c]),
);
