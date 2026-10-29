/**
 * The game: shows a creature's outline, scores the player's shadow against
 * it, wakes the creature when it matches, and keeps a little menagerie of
 * every creature the player has woken.
 */

import { createSystem } from '@iwsdk/core';
import { CREATURES, type CreatureDef } from '../core/creatures.js';
import { J } from '../core/hand-data.js';
import { type MatchResult, ShapeMatcher, type Target } from '../core/match.js';
import { RIG_HEIGHT, RIGS, SegWriter } from '../core/rigs.js';
import { creatureTarget } from '../core/targets.js';
import { audio } from './audio.js';
import { state, TOLERANCE_IOU } from './state.js';
import type { TheatreSystem } from './theatre.js';
import { GhostHand } from './ghost-hand.js';
import { WallText } from './wall-text.js';

export type Phase = 'idle' | 'intro' | 'seek' | 'awaken' | 'free';

interface Living {
  def: CreatureDef;
  x: number;
  y: number;
  s: number;
  facing: 1 | -1;
  alpha: number;
  t: number;
  mode: 'perform' | 'travel' | 'home' | 'leave';
  modeT: number;
  fromX: number;
  fromY: number;
  fromS: number;
  toX: number;
  toY: number;
  toS: number;
  action: number;
  nextAction: number;
  visitor: boolean;
}

const SAVE_KEY = 'shadowplay.v1';
const HOME_Y = -0.6;
const REST_T: Record<string, number> = { bird: 0.1, rabbit: 0, dog: 0, wolf: 0, fox: 0, swan: 0, crocodile: 0, deer: 0, butterfly: 0 };

export class GameSystem extends createSystem({}) {
  theatre: TheatreSystem | null = null;
  phase: Phase = 'idle';
  private phaseT = 0;
  private targets = new Map<string, Target>();
  private matcher = new ShapeMatcher();
  private order: CreatureDef[] = CREATURES;
  private idx = 0;
  private living: Living[] = [];
  collected = new Set<string>();
  private writer = new SegWriter(state.creatureSegs, state.creatureAlpha);

  // matching
  private matchClock = 0;
  iou = 0;
  iouSmooth = 0;
  private holdT = 0;
  private last: MatchResult | null = null;
  private lastTickLevel = 0;
  private best: CreatureDef | null = null;
  private cooldown = new Map<string, number>();
  private noHandsT = 0;
  private handsSeenT = 0;

  // outline transform (smoothed)
  private ox = 0;
  private oy = 0;
  private os = 0.25;
  private oa = 0;
  private om = 1;
  private outlineVis = 0;
  private flash = 0;
  private mouthOpen = false;
  private thumbsT = 0;

  title!: WallText;
  caption!: WallText;
  ghost!: GhostHand;
  /** The player's own hands, drawn in the desktop/webcam view only. */
  playerHands!: GhostHand;
  /** Forces the ghost hand on (debug / "show me" requests). */
  showGhost = false;
  /** Draw the player's hands even in XR (director mode, where no real hands are visible). */
  showPlayerHands = false;

  init(): void {
    for (const c of CREATURES) this.targets.set(c.id, creatureTarget(c));
    this.load();
    this.title = new WallText(1.2);
    this.caption = new WallText(1.0);
    this.world.createTransformEntity(this.title.mesh);
    this.world.createTransformEntity(this.caption.mesh);
    this.ghost = new GhostHand();
    this.world.createTransformEntity(this.ghost.root);
    this.playerHands = new GhostHand(0xf4ead8);
    this.playerHands.baseOpacity = 0.55;
    this.playerHands.live = state.hands;
    this.world.createTransformEntity(this.playerHands.root);
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { collected?: string[] };
      for (const id of data.collected ?? []) if (this.targets.has(id)) this.collected.add(id);
    } catch {
      /* storage unavailable: play without saving */
    }
  }

  private save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ collected: [...this.collected] }));
    } catch {
      /* ignore */
    }
  }

  get current(): CreatureDef | null {
    return this.phase === 'seek' ? this.order[this.idx] ?? null : null;
  }

  /** Starts (or restarts) the show once the stage exists. */
  private begin(): void {
    // Returning players find their menagerie waiting.
    this.living = [];
    let slot = 0;
    for (const c of this.order) {
      if (!this.collected.has(c.id)) continue;
      const home = this.homeOf(c, slot++);
      this.living.push(this.makeLiving(c, home[0], home[1], home[2], -1, 'home'));
    }
    this.idx = this.order.findIndex((c) => !this.collected.has(c.id));
    this.setPhase('intro');
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
    this.struggleT = 0;
    this.thumbsT = 0;
    this.holdT = 0;
    this.iouSmooth = 0;
    this.lastTickLevel = 0;
    const r = this.theatre?.shadows;
    if (p === 'seek' && r) {
      const c = this.order[this.idx];
      r.setTarget(this.targets.get(c.id)!);
      this.caption.show(`Make a ${c.name}`, c.hint);
    }
    if (p === 'free') {
      r?.setTarget(null);
      this.caption.show('Free play', 'Make any shadow you like. Your creatures will answer.');
    }
  }

  update(delta: number, time: number): void {
    const stage = state.stage;
    const r = this.theatre?.shadows;
    if (!stage || !r) return;
    const dt = Math.min(delta, 0.05);
    this.phaseT += dt;
    if (this.phase === 'idle') this.begin();

    // Text sits above the light pool.
    this.title.place(stage, 0, 0.62);
    this.caption.place(stage, 0, 0.47);

    const hasHands = state.handSegCount > 0;
    this.noHandsT = hasHands ? 0 : this.noHandsT + dt;
    this.handsSeenT = hasHands ? this.handsSeenT + dt : 0;

    switch (this.phase) {
      case 'intro':
        this.title.show('Shadowplay');
        if (this.phaseT > 1.2 && state.controllersInHand) this.caption.show('Put your controllers down', 'Shadowplay is played with your bare hands');
        else if (this.phaseT > 1.2) this.caption.show('Raise your hands into the light', 'between the lantern and the wall');
        if (this.phaseT > 3 && this.handsSeenT > 1.5) {
          this.title.hide();
          this.setPhase(this.idx < 0 ? 'free' : 'seek');
        }
        break;
      case 'seek':
        this.tickMatch(dt, false);
        if (this.phaseT > 20) {
          // Hands-only escape hatch: hold a thumbs-up to skip this creature.
          this.thumbsT = thumbsUp() ? this.thumbsT + dt : 0;
          if (this.thumbsT > 1.2) {
            this.caption.show('Skipped', 'It will wait for you in free play');
            this.skipped.add(this.order[this.idx].id);
            this.idx = this.nextUncollected(this.idx + 1);
            this.setPhase(this.idx < 0 ? 'free' : 'seek');
            break;
          }
        }
        if (state.controllersInHand && this.noHandsT > 1) this.caption.show('Put your controllers down', 'Shadowplay is played with your bare hands');
        else if (this.noHandsT > 5) this.caption.show('Hands into the light', 'Your shadow appears on the wall');
        else if (hasHands) {
          const c = this.order[this.idx];
          const sub = this.phaseT > 30 ? 'Stuck? Hold a thumbs-up to skip' : this.phaseT > 12 ? c.hint : '';
          this.caption.show(`Make a ${c.name}`, sub);
        }
        break;
      case 'awaken':
        if (this.phaseT > 3.2) {
          this.title.hide();
          this.idx = this.nextUncollected(this.idx + 1);
          this.setPhase(this.idx < 0 ? 'free' : 'seek');
        }
        break;
      case 'free':
        this.tickMatch(dt, true);
        if (this.phaseT > 6) this.caption.hide();
        break;
    }

    this.updateMouth();
    this.animate(dt, time);
    this.updateGhost(dt);

    // Wall shader uniforms.
    const k = 1 - Math.exp(-dt * 6);
    const following = this.last && this.iouSmooth > 0.35;
    const tx = following ? this.last!.frame.cx : this.defaultCentre()[0];
    const ty = following ? this.last!.frame.cy : this.defaultCentre()[1];
    const ts = following ? this.last!.frame.scale : this.defaultScale();
    const ta = following ? this.last!.angle : 0;
    const tm = following ? (this.last!.mirror ? -1 : 1) : state.settings.lampSide === 'left' ? -1 : 1;
    this.ox += (tx - this.ox) * k;
    this.oy += (ty - this.oy) * k;
    this.os += (ts - this.os) * k;
    this.oa += (ta - this.oa) * k;
    if (tm !== this.om) this.om = tm;
    const visTarget = this.phase === 'seek' ? 1 : 0;
    this.outlineVis += (visTarget - this.outlineVis) * Math.min(1, dt * 3);
    this.flash = Math.max(0, this.flash - dt * 1.6);
    const u = r.wallMat.uniforms;
    u.uTX.value.set(this.ox, this.oy, this.os, this.oa);
    u.uTMirror.value = this.om;
    u.uTVis.value = this.outlineVis;
    const thr = this.threshold(this.order[Math.max(0, this.idx)]);
    u.uGlow.value = Math.max(0, Math.min(1, (this.iouSmooth - 0.3) / (thr - 0.3)));
    u.uFlash.value = this.flash;

    this.title.update(dt);
    this.caption.update(dt);
  }

  /** Next creature not yet woken, starting at `from` and wrapping around. */
  private nextUncollected(from: number): number {
    const n = this.order.length;
    for (let k = 0; k < n; k++) {
      const i = (from + k) % n;
      if (!this.collected.has(this.order[i].id) && !this.skipped.has(this.order[i].id)) return i;
    }
    return -1;
  }

  private skipped = new Set<string>();

  private defaultCentre(): [number, number] {
    return [0, 0.08];
  }

  private defaultScale(): number {
    const t = this.targets.get(this.order[Math.max(0, this.idx)]?.id ?? 'bird');
    return (t?.scale0 ?? 0.25) * (state.magnification / 2.6);
  }

  /** Seconds spent close-but-not-quite on the current creature. */
  private struggleT = 0;

  private threshold(c: CreatureDef | undefined): number {
    const base = TOLERANCE_IOU[state.settings.tolerance];
    // Adaptive assist: if the player hovers near the bar, lower it gently
    // (up to 0.08 over ~25 s) instead of letting them get frustrated.
    const assist = Math.min(0.08, this.struggleT * 0.0032);
    return (c && c.difficulty === 3 ? base - 0.06 : base) - assist;
  }

  private tickMatch(dt: number, free: boolean): void {
    this.matchClock += dt;
    const interval = free ? 1 / 6 : 1 / 12;
    if (this.matchClock >= interval) {
      this.matchClock = 0;
      let bestIou = 0;
      let secondIou = 0;
      let bestRes: MatchResult | null = null;
      let bestDef: CreatureDef | null = null;
      if (state.handSegCount > 0) {
        const pool = free
          ? this.order.filter((c) => this.collected.has(c.id) || this.skipped.has(c.id))
          : [this.order[this.idx]];
        for (const c of pool) {
          const res = this.matcher.match(state.handSegs, state.handSegCount, this.targets.get(c.id)!);
          if (res && res.iou > bestIou) {
            secondIou = bestIou;
            bestIou = res.iou;
            bestDef = c;
            bestRes = { ...res, frame: { ...res.frame } };
          } else if (res && res.iou > secondIou) {
            secondIou = res.iou;
          }
        }
      }
      // In free play an ambiguous shape (two creatures nearly tied) wakes nobody.
      if (free && bestIou - secondIou < 0.04) bestIou = Math.min(bestIou, 0.45);
      if (free && bestDef !== this.best) this.iouSmooth *= 0.5;
      this.best = bestDef;
      this.iou = bestIou;
      this.last = bestRes;
      this.iouSmooth += (bestIou - this.iouSmooth) * 0.35;
      // rising ticks as the match builds
      const thr = this.threshold(free ? bestDef ?? undefined : this.order[this.idx]);
      const level = Math.floor(Math.max(0, (this.iouSmooth - 0.3) / (thr - 0.3)) * 4);
      if (!free && level > this.lastTickLevel && level <= 4) audio.tick(level / 4);
      this.lastTickLevel = level;
    }
    const def = free ? this.best : this.order[this.idx];
    if (!def) return;
    if (!free && this.iouSmooth > 0.4) this.struggleT += dt;
    const thr = this.threshold(def);
    if (this.iouSmooth >= thr) this.holdT += dt;
    else this.holdT = Math.max(0, this.holdT - dt * 2);
    if (this.holdT >= 0.6 && this.last) {
      if (free && !this.collected.has(def.id)) {
        // a skipped creature, finally made in free play: it joins for real
        this.wake(def, this.last, false);
        this.holdT = 0;
        return;
      }
      if (free) {
        const cd = this.cooldown.get(def.id) ?? 0;
        if (performance.now() / 1000 > cd) {
          this.cooldown.set(def.id, performance.now() / 1000 + 5);
          this.wake(def, this.last, true);
        }
        this.holdT = 0;
      } else {
        this.wake(def, this.last, false);
      }
    }
  }

  private wake(def: CreatureDef, m: MatchResult, visitor: boolean): void {
    const s = Math.max(0.5, Math.min(1.6, m.frame.scale / 0.2));
    const h = RIG_HEIGHT[def.id] ?? 0.3;
    // Canonical poses face left; a mirrored match faces right.
    const facing: 1 | -1 = m.mirror ? 1 : -1;
    const lv = this.makeLiving(def, m.frame.cx, m.frame.cy - (h * s) / 2, s, facing, 'perform');
    lv.alpha = 0;
    lv.visitor = visitor;
    this.living.push(lv);
    this.flash = 1;
    audio.awaken();
    audio.song(def.song, 0.15, Math.max(-1, Math.min(1, m.frame.cx)));
    if (def.id === 'wolf') audio.howl(0.7);
    if (!visitor) {
      this.collected.add(def.id);
      this.save();
      this.title.show(`${def.name}!`);
      this.caption.hide();
      this.setPhase('awaken');
    }
  }

  private makeLiving(def: CreatureDef, x: number, y: number, s: number, facing: 1 | -1, mode: Living['mode']): Living {
    return {
      def,
      x,
      y,
      s,
      facing,
      alpha: 1,
      t: REST_T[def.id] ?? 0,
      mode,
      modeT: 0,
      fromX: x,
      fromY: y,
      fromS: s,
      toX: x,
      toY: y,
      toS: s,
      action: 0,
      nextAction: 2 + Math.random() * 4,
      visitor: false,
    };
  }

  /** Shelf positions along the bottom rim of the light pool (up to nine creatures). */
  private homeOf(def: CreatureDef, slot?: number): [number, number, number] {
    const i = Math.max(0, slot ?? [...this.collected].indexOf(def.id)) % 9;
    const x = -0.76 + i * 0.19;
    const y = HOME_Y + 0.22 * Math.pow(x / 0.8, 2); // the rim curves up at the sides
    const lift = def.id === 'butterfly' ? 0.16 : def.id === 'bird' ? 0.06 : 0;
    const s = def.id === 'deer' ? 0.3 : def.id === 'crocodile' ? 0.32 : 0.38;
    return [x, y + lift, s];
  }

  private animate(dt: number, _time: number): void {
    const w = this.writer;
    w.n = 0;
    for (const lv of this.living) {
      lv.modeT += dt;
      switch (lv.mode) {
        case 'perform':
          lv.alpha = Math.min(1, lv.alpha + dt * 3);
          lv.t += dt;
          lv.action = 0.5 + 0.5 * Math.sin(lv.modeT * 6);
          if (lv.modeT > 2.2) {
            lv.mode = lv.visitor ? 'leave' : 'travel';
            lv.modeT = 0;
            lv.fromX = lv.x;
            lv.fromY = lv.y;
            lv.fromS = lv.s;
            if (lv.visitor) {
              lv.toX = lv.x + lv.facing * 1.4;
              lv.toY = lv.y;
              lv.toS = lv.s;
            } else {
              [lv.toX, lv.toY, lv.toS] = this.homeOf(lv.def);
              lv.facing = lv.toX >= lv.x ? 1 : -1;
            }
          }
          break;
        case 'travel':
        case 'leave': {
          const dur = lv.mode === 'leave' ? 2.4 : 2.6;
          const k = Math.min(1, lv.modeT / dur);
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          lv.x = lv.fromX + (lv.toX - lv.fromX) * e;
          lv.y = lv.fromY + (lv.toY - lv.fromY) * e + Math.sin(k * Math.PI) * 0.06;
          lv.s = lv.fromS + (lv.toS - lv.fromS) * e;
          lv.t += dt;
          lv.action = 0;
          if (lv.mode === 'leave') lv.alpha = 1 - Math.max(0, (k - 0.6) / 0.4);
          if (k >= 1) {
            if (lv.mode === 'leave') lv.alpha = 0;
            lv.mode = 'home';
            lv.modeT = 0;
            lv.t = REST_T[lv.def.id] ?? 0;
            lv.facing = lv.x > 0 ? -1 : 1;
          }
          break;
        }
        case 'home': {
          // mostly still, with an occasional flourish
          const moving = lv.def.id === 'bird' || lv.def.id === 'butterfly' || lv.def.id === 'swan';
          lv.t += dt * (moving ? 0.35 : 0);
          lv.nextAction -= dt;
          if (lv.nextAction < 0) {
            lv.action = 1;
            lv.nextAction = 4 + Math.random() * 6;
            if (lv.def.id === 'wolf' && Math.random() < 0.35) audio.howl(0.35);
          }
          lv.action = Math.max(0, lv.action - dt * 1.5);
          break;
        }
      }
      if (lv.alpha <= 0.01) continue;
      const rig = RIGS[lv.def.id];
      const breathe = lv.mode === 'home' ? 1 + Math.sin(lv.modeT * 2 + lv.x * 7) * 0.012 : 1;
      w.begin(lv.x, lv.y, lv.s * breathe, lv.facing, lv.alpha);
      rig(w, lv.t, lv.action);
    }
    // drop finished visitors
    this.living = this.living.filter((lv) => !(lv.visitor && lv.mode === 'home'));
    state.creatureSegCount = w.n;
  }

  /**
   * The ghost hand teaches the first creature straight away, and steps in
   * for later ones when the player seems stuck. It bows out as soon as the
   * player's shadow gets close.
   */
  private updateGhost(dt: number): void {
    const c = this.phase === 'seek' ? this.order[this.idx] : null;
    const firstTime = this.collected.size === 0 && this.phaseT > 1.5;
    const stuck = this.phaseT > 7 && this.iouSmooth < 0.45;
    if (c && (this.showGhost || ((firstTime || stuck) && this.iouSmooth < 0.5))) this.ghost.show(c);
    else this.ghost.hide();
    this.ghost.update(dt);
    // In the headset the player sees their real hands; on a screen we draw them.
    if ((state.virtualWall || this.showPlayerHands) && state.handSegCount > 0) this.playerHands.show(this.order[0]);
    else this.playerHands.hide();
    this.playerHands.update(dt);
  }

  /** Talking shadows: open the beak to chirp, drop the jaw to bark. */
  private updateMouth(): void {
    const def = this.phase === 'free' ? this.best : this.phase === 'seek' ? this.order[this.idx] : null;
    if (!def || this.iouSmooth < 0.42) {
      this.mouthOpen = false;
      return;
    }
    const right = state.hands[1].tracked ? state.hands[1] : state.hands[0];
    if (!right.tracked) return;
    const j = right.joints;
    const d = (a: number, b: number) =>
      Math.hypot(j[a * 3] - j[b * 3], j[a * 3 + 1] - j[b * 3 + 1], j[a * 3 + 2] - j[b * 3 + 2]);
    const size = Math.max(0.12, d(J.WRIST, J.MIDDLE_TIP));
    let open = false;
    if (def.id === 'bird') open = d(J.THUMB_TIP, J.INDEX_TIP) / size > 0.32;
    else if (def.id === 'dog' || def.id === 'wolf') open = d(J.PINKY_TIP, J.RING_TIP) / size > 0.2;
    else if (def.id === 'crocodile' && state.hands[0].tracked && state.hands[1].tracked) {
      const L = state.hands[0].joints;
      const R = state.hands[1].joints;
      const m = J.MIDDLE_TIP * 3;
      open = Math.hypot(L[m] - R[m], L[m + 1] - R[m + 1], L[m + 2] - R[m + 2]) / size > 0.45;
    } else return;
    if (open && !this.mouthOpen) {
      if (def.id === 'bird') audio.chirp(0.9 + Math.random() * 0.2);
      else if (def.id === 'dog') audio.bark();
      else if (def.id === 'wolf') audio.howl(0.8);
      else audio.snap();
    }
    this.mouthOpen = open;
  }

  /** Forget the menagerie (menu action). */
  reset(): void {
    this.collected.clear();
    this.skipped.clear();
    this.living = [];
    this.save();
    this.phase = 'idle';
  }
}

/** A one-handed thumbs-up: thumb tip well above the wrist, fingers curled. */
function thumbsUp(): boolean {
  for (const h of state.hands) {
    if (!h.tracked) continue;
    const j = h.joints;
    const y = (i: number) => j[i * 3 + 1];
    const d = (a: number, b: number) =>
      Math.hypot(j[a * 3] - j[b * 3], j[a * 3 + 1] - j[b * 3 + 1], j[a * 3 + 2] - j[b * 3 + 2]);
    const thumbUp = y(J.THUMB_TIP) - y(J.WRIST) > 0.09 && y(J.THUMB_TIP) > y(J.INDEX_PP) + 0.03;
    const curled = [J.INDEX_TIP, J.MIDDLE_TIP, J.RING_TIP, J.PINKY_TIP].every((t) => d(t, J.WRIST) < 0.11);
    if (thumbUp && curled) return true;
  }
  return false;
}
