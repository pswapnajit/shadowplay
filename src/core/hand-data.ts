/**
 * Hand skeleton data shared by the runtime and the offline tools.
 *
 * Joint order matches the WebXR `XRHand` iteration order, so a
 * `jointTransforms` buffer from the input layer can be read by index.
 *
 * REST is a real Quest hand-tracking capture (IWER's "relaxed" pose, MIT,
 * Meta Platforms) re-expressed as a RIGHT hand in a palm frame:
 *   +x = ulnar (pinky side), +y = distal (towards fingers), +z = dorsal.
 * Positions are metres relative to the wrist joint; r is the joint radius.
 */

export type V3 = [number, number, number];

export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];
export const JOINT_COUNT = JOINT_NAMES.length; // 25

export const J = {
  WRIST: 0,
  THUMB_MC: 1,
  THUMB_PP: 2,
  THUMB_DP: 3,
  THUMB_TIP: 4,
  INDEX_MC: 5,
  INDEX_PP: 6,
  INDEX_IP: 7,
  INDEX_DP: 8,
  INDEX_TIP: 9,
  MIDDLE_MC: 10,
  MIDDLE_PP: 11,
  MIDDLE_IP: 12,
  MIDDLE_DP: 13,
  MIDDLE_TIP: 14,
  RING_MC: 15,
  RING_PP: 16,
  RING_IP: 17,
  RING_DP: 18,
  RING_TIP: 19,
  PINKY_MC: 20,
  PINKY_PP: 21,
  PINKY_IP: 22,
  PINKY_DP: 23,
  PINKY_TIP: 24,
} as const;

/** First joint index (the metacarpal joint) of each long finger. */
export const FINGER_BASE = {
  index: J.INDEX_MC,
  middle: J.MIDDLE_MC,
  ring: J.RING_MC,
  pinky: J.PINKY_MC,
} as const;
export type FingerName = keyof typeof FINGER_BASE;
export const FINGERS: FingerName[] = ['index', 'middle', 'ring', 'pinky'];

export const REST: { p: V3; r: number }[] = [
  { p: [0, 0, 0], r: 0.02146 },
  { p: [-0.02758, 0.03547, -0.01855], r: 0.01938 },
  { p: [-0.04664, 0.05879, -0.0308], r: 0.01228 },
  { p: [-0.06709, 0.08448, -0.03879], r: 0.00977 },
  { p: [-0.07994, 0.10368, -0.0473], r: 0.00877 },
  { p: [-0.01801, 0.03705, -0.01073], r: 0.02123 },
  { p: [-0.02111, 0.09657, -0.00728], r: 0.0103 },
  { p: [-0.0267, 0.13406, -0.00836], r: 0.00854 },
  { p: [-0.02918, 0.15743, -0.01455], r: 0.00764 },
  { p: [-0.02995, 0.17894, -0.02072], r: 0.00664 },
  { p: [-0.00217, 0.03455, -0.00704], r: 0.02123 },
  { p: [0, 0.0957, 0], r: 0.01117 },
  { p: [0.00568, 0.13816, 0.00268], r: 0.00803 },
  { p: [0.01009, 0.16451, -0.00406], r: 0.00763 },
  { p: [0.01445, 0.18846, -0.00972], r: 0.00663 },
  { p: [0.01611, 0.03465, -0.00323], r: 0.01909 },
  { p: [0.01942, 0.08851, -0.00191], r: 0.00992 },
  { p: [0.02855, 0.12597, 0.00389], r: 0.00761 },
  { p: [0.03451, 0.15164, 0.00049], r: 0.00723 },
  { p: [0.03868, 0.17523, -0.00408], r: 0.00623 },
  { p: [0.02445, 0.03389, -0.00569], r: 0.01809 },
  { p: [0.03757, 0.07759, -0.00728], r: 0.00848 },
  { p: [0.05036, 0.10518, -0.00293], r: 0.00676 },
  { p: [0.05912, 0.1231, -0.00673], r: 0.00643 },
  { p: [0.06647, 0.14348, -0.01032], r: 0.00543 },
];

/**
 * Capsules that make up a hand's shadow, as joint-index pairs. Bones follow
 * the skeleton; the extra palm and web capsules fill the gaps a bare
 * skeleton would leave in the silhouette.
 */
export const SHADOW_BONES: ReadonlyArray<readonly [number, number]> = [
  // thumb, including the fleshy thenar pad from the wrist
  [J.WRIST, J.THUMB_MC],
  [J.THUMB_MC, J.THUMB_PP],
  [J.THUMB_PP, J.THUMB_DP],
  [J.THUMB_DP, J.THUMB_TIP],
  // long fingers: wrist→metacarpal joint→knuckle→…→tip
  ...(['index', 'middle', 'ring', 'pinky'] as FingerName[]).flatMap((f) => {
    const b = FINGER_BASE[f];
    return [
      [J.WRIST, b],
      [b, b + 1],
      [b + 1, b + 2],
      [b + 2, b + 3],
      [b + 3, b + 4],
    ] as [number, number][];
  }),
  // palm fill
  [J.INDEX_PP, J.MIDDLE_PP],
  [J.MIDDLE_PP, J.RING_PP],
  [J.RING_PP, J.PINKY_PP],
  [J.INDEX_MC, J.PINKY_MC],
  [J.THUMB_MC, J.INDEX_MC],
  // skin web between thumb and index finger
  [J.THUMB_PP, J.INDEX_MC],
];

/** Radius multiplier per shadow bone (same order as SHADOW_BONES). */
export const SHADOW_BONE_RADIUS_SCALE: ReadonlyArray<number> = SHADOW_BONES.map(([a, b]) => {
  if (a === J.THUMB_PP && b === J.INDEX_MC) return 0.55; // thin web
  // Phalanges: tracked joint radii describe the bone; skin is a bit wider,
  // and fingers held together should read as one solid shape.
  const isPhalanx = b !== J.WRIST && a !== J.WRIST && b - a === 1 && ![1, 5, 10, 15, 20].includes(a);
  return isPhalanx ? 1.12 : 1.0;
});

/**
 * Joint pairs that merge into one shadow when they touch (fingers held
 * together, thumb resting on a finger). Real skin closes those gaps; a bare
 * skeleton would leave slits of light between them.
 */
export const CONTACT_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [J.INDEX_IP, J.MIDDLE_IP],
  [J.INDEX_DP, J.MIDDLE_DP],
  [J.INDEX_TIP, J.MIDDLE_TIP],
  [J.MIDDLE_IP, J.RING_IP],
  [J.MIDDLE_DP, J.RING_DP],
  [J.MIDDLE_TIP, J.RING_TIP],
  [J.RING_IP, J.PINKY_IP],
  [J.RING_DP, J.PINKY_DP],
  [J.RING_TIP, J.PINKY_TIP],
  [J.THUMB_TIP, J.INDEX_TIP],
  [J.THUMB_TIP, J.INDEX_DP],
  [J.THUMB_TIP, J.MIDDLE_TIP],
  [J.THUMB_TIP, J.MIDDLE_DP],
  [J.THUMB_TIP, J.RING_TIP],
  [J.THUMB_DP, J.INDEX_IP],
];

/** Segments per hand: bones, contact bridges, forearm. */
export const BONES_PER_HAND = SHADOW_BONES.length + CONTACT_PAIRS.length + 1;
