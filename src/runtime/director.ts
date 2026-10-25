/**
 * Director mode (`?director`): plays a scripted performance on synthetic
 * hands so the demo video can be recorded in the XR emulator without a
 * headset. Only the hands are scripted; everything else (matching, waking,
 * the menagerie, sounds) is the real game reacting to them.
 */

import { createSystem } from '@iwsdk/core';
import { CREATURE_BY_ID, type HandSpec } from '../core/creatures.js';
import { JOINT_COUNT, type V3 } from '../core/hand-data.js';
import { OPEN_HAND, REST_RADII, type Side, lerpPose } from '../core/hand-model.js';
import { placeSpec } from './demo-hands.js';
import type { GameSystem } from './game.js';
import { state } from './state.js';
import { externalHands, type TheatreSystem } from './theatre.js';

interface Key {
  t: number;
  /** Hands to show; a side that is missing goes away (lowered out of the light). */
  hands: HandSpec[];
  /** Seconds to ease from the previous key. */
  over?: number;
  /** Show the ghost hand from this key on (until a key sets it false). */
  ghost?: boolean;
}

const rest = (side: Side): HandSpec => ({
  side,
  pose: OPEN_HAND,
  finger: side === 'right' ? [-0.15, 1, -0.25] : [0.15, 1, -0.25],
  dorsal: [0, 0.2, 1],
  wrist: side === 'right' ? [0.07, -0.14, -0.38] : [-0.05, -0.14, -0.38],
});
const away = (side: Side): HandSpec => ({
  ...rest(side),
  wrist: side === 'right' ? [0.16, -0.55, -0.22] : [-0.16, -0.55, -0.22],
});
const at = (spec: HandSpec, wrist: V3): HandSpec => ({ ...spec, wrist });

function c(id: string, mouth = 0): HandSpec[] {
  const def = CREATURE_BY_ID[id];
  if (!mouth || !def.alt) return def.hands;
  return def.hands.map((h, i) => blendSpec(h, def.alt![i], mouth));
}

function blendSpec(a: HandSpec, b: HandSpec, t: number): HandSpec {
  const l = (x: V3, y: V3): V3 => [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  return { side: a.side, pose: lerpPose(a.pose, b.pose, t), finger: l(a.finger, b.finger), dorsal: l(a.dorsal, b.dorsal), wrist: l(a.wrist, b.wrist) };
}

/** Each creature: show the ghost, ease in, hold until it wakes, then relax. */
function creatureBeat(t0: number, id: string): Key[] {
  const two = CREATURE_BY_ID[id].hands.length > 1;
  return [
    { t: t0, hands: two ? [rest('right'), rest('left')] : [rest('right')], over: 1.0, ghost: true },
    { t: t0 + 1.4, hands: c(id), over: 2.2 },
    { t: t0 + 5.4, hands: c(id), over: 0.1, ghost: false },
  ];
}

function script(): Key[] {
  const k: Key[] = [{ t: 0, hands: [] }];
  // the lantern arrives and the wall lights up; then a hand rises into the light
  k.push({ t: 5.5, hands: [rest('right')], over: 1.6 });
  // tutorial creature: the game's own first-time ghost is shown
  k.push({ t: 10.5, hands: c('bird'), over: 2.6 });
  k.push({ t: 16, hands: [rest('right')], over: 1.2 });
  let t = 18;
  for (const id of ['rabbit', 'dog', 'wolf', 'fox', 'swan', 'crocodile', 'deer', 'butterfly']) {
    k.push(...creatureBeat(t, id));
    t += 8.6;
  }
  // free play: talking shadows
  k.push({ t, hands: [rest('right')], over: 1.2 });
  k.push({ t: t + 1.5, hands: c('bird'), over: 1.8 });
  for (let i = 0; i < 3; i++) {
    k.push({ t: t + 4 + i * 0.9, hands: c('bird', 1), over: 0.35 });
    k.push({ t: t + 4.45 + i * 0.9, hands: c('bird'), over: 0.35 });
  }
  t += 7.5;
  k.push({ t, hands: c('dog'), over: 1.6 });
  for (let i = 0; i < 2; i++) {
    k.push({ t: t + 2.2 + i * 1.1, hands: c('dog', 1), over: 0.3 });
    k.push({ t: t + 2.7 + i * 1.1, hands: c('dog'), over: 0.3 });
  }
  t += 5.5;
  // real shadow physics: towards the lantern (bigger, softer), then the wall (smaller, sharper)
  const open = rest('right');
  k.push({ t, hands: [open], over: 1.2 });
  k.push({ t: t + 1.6, hands: [at(open, [0.16, -0.09, -0.16])], over: 2.4 });
  k.push({ t: t + 4.6, hands: [at(open, [0.0, -0.12, -0.62])], over: 2.6 });
  k.push({ t: t + 8, hands: [], over: 1.5 });
  k.push({ t: t + 13, hands: [] });
  return k;
}

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

export class DirectorSystem extends createSystem({}) {
  theatre: TheatreSystem | null = null;
  game: GameSystem | null = null;
  private keys: Key[] = script();
  private t = -1;
  private until = Infinity;
  private readonly joints = [new Float32Array(JOINT_COUNT * 3), new Float32Array(JOINT_COUNT * 3)];
  readonly duration = this.keys[this.keys.length - 1].t;

  /**
   * Plays the performance from `from` to `until` seconds (recorded in
   * segments). Starting at 0 also restarts the show from the lantern's entrance.
   */
  start(from = 0, until = Infinity): void {
    this.t = from;
    this.until = until;
    externalHands.active = true;
    if (from === 0) {
      this.theatre?.restartShow();
      this.game?.reset();
    }
    if (this.game) this.game.showPlayerHands = true;
  }

  get running(): boolean {
    return this.t >= 0 && this.t <= this.duration;
  }

  update(delta: number): void {
    if (this.t < 0 || this.t >= this.until) return;
    this.t = Math.min(this.until, this.t + Math.min(delta, 0.05));
    const t = this.t;
    let i = 0;
    while (i + 1 < this.keys.length && this.keys[i + 1].t <= t) i++;
    const cur = this.keys[i];
    const prev = this.keys[Math.max(0, i - 1)];
    const k = ease(Math.min(1, (t - cur.t) / Math.max(0.01, cur.over ?? 0.01)));
    // ghost flag: the latest key that sets it
    let ghost = false;
    for (let j = 0; j <= i; j++) if (this.keys[j].ghost !== undefined) ghost = this.keys[j].ghost!;
    if (this.game) this.game.showGhost = ghost;

    for (const side of ['left', 'right'] as Side[]) {
      const h = side === 'left' ? state.hands[0] : state.hands[1];
      const from = prev.hands.find((s) => s.side === side) ?? away(side);
      const to = cur.hands.find((s) => s.side === side) ?? away(side);
      const present = cur.hands.some((s) => s.side === side) || (prev.hands.some((s) => s.side === side) && k < 1);
      h.tracked = present;
      if (!present) continue;
      placeSpec(from, this.joints[side === 'left' ? 0 : 1], to, k);
      h.joints.set(this.joints[side === 'left' ? 0 : 1]);
      h.radii.set(REST_RADII);
    }
    state.handSource = 'demo';
  }
}
