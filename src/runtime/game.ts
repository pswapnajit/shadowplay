/**
 * The game: shows a creature's outline, scores the player's shadow against
 * it, wakes the creature when it matches, and keeps a little menagerie of
 * every creature the player has woken. In story mode the Lantern tells a
 * tale and each ask becomes a shadow to make; the creatures who answer
 * become its cast.
 */

import { createSystem, Vector3, type Vector4, VisibilityState } from '@iwsdk/core';
import { CREATURE_BY_ID, CREATURES, type CreatureDef } from '../core/creatures.js';
import { J } from '../core/hand-data.js';
import { type MatchResult, ShapeMatcher, type Target } from '../core/match.js';
import { RIG_HEIGHT, RIGS, SegWriter } from '../core/rigs.js';
import { fingerShape, fingersFit, straightnessFits } from '../core/fingers.js';
import type { Stage } from '../core/shadow-geom.js';
import type { Scene } from '../net/wire.js';
import { creatureTarget, decoyTargets, specJoints } from '../core/targets.js';
import { keepsakesOf, loadBook } from '../story/book.js';
import type { Action, Ask, CreatureId, Keepsake } from '../story/protocol.js';
import { audio } from './audio.js';
import { duet } from './duet.js';
import { Garland } from './keepsakes.js';
import { state, TOLERANCE_IOU } from './state.js';
import { canFly, StoryMode, type StoryHost } from './story-mode.js';
import type { TheatreSystem } from './theatre.js';
import { GhostHand } from './ghost-hand.js';
import { voice } from './voice.js';
import { WallText } from './wall-text.js';

export type Phase = 'idle' | 'intro' | 'seek' | 'awaken' | 'free' | 'story';

interface Living {
  def: CreatureDef;
  x: number;
  y: number;
  s: number;
  facing: 1 | -1;
  alpha: number;
  t: number;
  mode: 'perform' | 'travel' | 'home' | 'leave' | 'story';
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
  /** Where it settles after performing: the shelf, or its spot on the story stage. */
  dest: 'home' | 'stage';
  /** Story stage spot: x, y, scale. */
  spot: [number, number, number];
  /** The stage direction it is acting out, and for how long. */
  act: Action | null;
  actT: number;
  actFrom: number;
  actTo: number;
  /** A direction given while it was still arriving. */
  pending: Action | null;
  pose: 'stand' | 'sleep' | 'hide' | 'fly';
  /** 0..1, how far it has risen into the air (fliers). */
  lift: number;
  /** Curtain call: walk home to the shelf after the bow. */
  curtain: boolean;
}

const SAVE_KEY = 'shadowplay.v1';
const HOME_Y = -0.6;
const REST_T: Record<string, number> = { bird: 0.1, rabbit: 0, dog: 0, wolf: 0, fox: 0, swan: 0, crocodile: 0, deer: 0, butterfly: 0 };
/** Story stage spots along the ground line, filled in this order. */
const STAGE_X = [-0.55, 0.55, -0.86, 0.86, -0.3, 0.3];
/** Look to choose: seconds of looking that pick a creature, or a caption's action. */
const DWELL = 1.4;
const DWELL_CAPTION = 1.8;

type GazeKind = 'outline' | 'shelf' | 'caption';

export class GameSystem extends createSystem({}) implements StoryHost {
  theatre: TheatreSystem | null = null;
  phase: Phase = 'idle';
  private phaseT = 0;
  private targets = new Map<string, Target>();
  /** Hands that aren't making anything (open, relaxed, fist…): a creature must beat them to wake. */
  private decoys: Target[] = decoyTargets();
  private matcher = new ShapeMatcher();
  private poolTargets: Target[] = [];
  /** One-handed shapes: which fingers each needs curled or straight (an open hand isn't a rabbit, a fist isn't a bird). */
  private fingers = new Map<string, number[]>();
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
  /** Brief notices under the shelf (a friend joined or left). */
  toast!: WallText;
  private toastT = 0;
  /** Two-player mode: the best shadow this moment is the friend's. */
  private bestFriend = false;
  /** Guest: the outline the host's wall is showing. */
  private mirrorTarget: string | null = null;
  ghost!: GhostHand;
  /** The player's own hands, drawn in the desktop/webcam view only. */
  playerHands!: GhostHand;
  /** Forces the ghost hand on (debug / "show me" requests). */
  showGhost = false;
  /** Draw the player's hands even in XR (director mode, where no real hands are visible). */
  showPlayerHands = false;

  story!: StoryMode;
  /** Story mode (the default); `?story=off` plays the classic lessons instead. */
  storyOn = true;
  private toldThisSession = false;
  /** Shelf creatures dim while a story is on stage: they become its audience. */
  private shelfDim = 1;
  /** Hands-free players pick from the shelf, so it rises a little into the light while they choose. */
  private shelfLift = 0;
  /** Every finished tale's keepsake, hanging on a thread across the theatre. */
  garland = new Garland(keepsakesOf(loadBook()));

  // Look to choose (hands-free): where the player is looking on the wall, and for how long.
  private gazeXY: [number, number] = [0, 0];
  private gazeKind: GazeKind | null = null;
  private gazeOf: Living | null = null;
  private gazeT = 0;
  private gazeShown = 0;
  /** On a screen, the pointer stands in for the head (a mouse, trackpad, head mouse or eye tracker). */
  private pointer = { x: 0, y: 0, t: -1 };
  private readonly rayO = new Vector3();
  private readonly rayD = new Vector3();

  init(): void {
    const onPointer = (e: PointerEvent) => {
      this.pointer.x = (e.clientX / innerWidth) * 2 - 1;
      this.pointer.y = 1 - (e.clientY / innerHeight) * 2;
      this.pointer.t = performance.now();
    };
    addEventListener('pointermove', onPointer);
    this.cleanupFuncs.push(() => removeEventListener('pointermove', onPointer));
    for (const c of CREATURES) {
      this.targets.set(c.id, creatureTarget(c));
      if (c.hands.length === 1) this.fingers.set(c.id, fingerShape(specJoints(c.hands[0])));
    }
    this.load();
    this.title = new WallText(1.2);
    this.caption = new WallText(1.0);
    this.toast = new WallText(1.0);
    this.world.createTransformEntity(this.title.mesh);
    this.world.createTransformEntity(this.caption.mesh);
    this.world.createTransformEntity(this.toast.mesh);
    duet.onPeer = (here) => {
      this.toastT = 6;
      if (duet.guest) this.toast.show(here ? `You're in theatre ${duet.code}` : 'The theatre has closed', here ? 'Your shadows fall in blue on your friend’s wall' : 'Its host has gone');
      else this.toast.show(here ? 'A friend has joined' : 'Your friend has gone', here ? 'Their shadows fall in blue, from their own lantern' : 'The theatre stays open for them');
    };
    this.ghost = new GhostHand();
    this.world.createTransformEntity(this.ghost.root);
    this.playerHands = new GhostHand(0xf4ead8);
    this.playerHands.baseOpacity = 0.55;
    this.playerHands.live = state.hands;
    this.world.createTransformEntity(this.playerHands.root);
    this.story = new StoryMode(this);
    this.world.createTransformEntity(this.story.panel.mesh);
    this.story.onDone = () => this.setPhase('free');
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

  /** True once the current phase has run for `seconds` (the director's sense of timing). */
  phaseWaitedFor(seconds: number): boolean {
    return this.phaseT >= seconds;
  }

  /** The creature the story is asking for right now (null for "any", or when not asking). */
  get storyWant(): CreatureDef | null {
    const a = this.story?.ask;
    return this.phase === 'story' && this.story.phase === 'asking' && a && a !== 'any' ? CREATURE_BY_ID[a] : null;
  }

  /** Starts (or restarts) the show once the stage exists. */
  private begin(): void {
    // One-hand play teaches (and asks for) only the creatures made with one hand.
    this.order = state.settings.oneHand ? CREATURES.filter((c) => c.hands.length === 1) : CREATURES;
    // Returning players find their menagerie waiting.
    this.living = [];
    for (const c of CREATURES) {
      if (!this.collected.has(c.id)) continue;
      const home = this.homeOf(c);
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
    if (p !== 'story' && this.story.active) this.story.stop();
    const r = this.theatre?.shadows;
    if (p === 'seek' && r) {
      const c = this.order[this.idx];
      r.setTarget(this.targets.get(c.id)!);
      this.caption.show(`Make a ${c.name}`, c.hint);
    }
    if (p === 'free') {
      r?.setTarget(null);
      this.caption.show('Free play', this.storyOn ? 'Make any shadow. Thumbs up for another story.' : 'Make any shadow you like. Your creatures will answer.');
    }
    if (p === 'story') {
      this.toldThisSession = true;
      r?.setTarget(null);
      this.caption.hide();
      this.title.hide();
      this.story.start();
    }
  }

  update(delta: number, time: number): void {
    if (state.frozen) return;
    const stage = state.stage;
    const r = this.theatre?.shadows;
    if (!stage || !r) return;
    // The system menu is open over the session: hold the show (and the story) until it closes.
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) return;
    const dt = Math.min(delta, 0.05);
    this.toastT -= dt;
    if (this.toastT <= 0) this.toast.hide();
    this.toast.place(stage, 0, -0.9);
    this.toast.update(dt);
    // A friend's theatre shows the host's stage; this one only casts.
    if (duet.guest) {
      this.updateGuest(dt, stage);
      return;
    }
    this.phaseT += dt;
    if (this.phase === 'idle') this.begin();

    // Text sits above the light pool.
    this.title.place(stage, 0, 0.62);
    // In a story the ask sits higher, clear of tall outlines (the title is hidden then).
    this.caption.place(stage, 0, this.phase === 'story' ? 0.64 : 0.47);
    this.story.panel.place(stage, 0, 0.56);

    const hasHands = state.handSegCount > 0;
    this.noHandsT = hasHands ? 0 : this.noHandsT + dt;
    this.handsSeenT = hasHands ? this.handsSeenT + dt : 0;

    switch (this.phase) {
      case 'intro':
        this.title.show('Shadowplay');
        if (this.phaseT > 1.2 && state.controllersInHand) this.caption.show('Put your controllers down', 'Shadowplay is played with your bare hands');
        else if (this.phaseT > 1.2) this.caption.show('Raise your hands into the light', state.settings.look ? 'or just look: your eyes can choose too' : 'between the lantern and the wall');
        // Hands-free players don't need to raise their hands to begin.
        if (this.phaseT > 3 && (this.handsSeenT > 1.5 || (state.settings.look && state.audience && this.phaseT > 5))) {
          this.title.hide();
          // A player who knows at least one creature goes straight to a story.
          this.setPhase(this.storyOn && this.collected.size > 0 ? 'story' : this.idx < 0 ? 'free' : 'seek');
        }
        break;
      case 'seek':
        this.tickMatch(dt, 'seek');
        if (this.phaseT > 20) {
          // Hands-only escape hatch: hold a thumbs-up to skip this creature.
          this.thumbsT = thumbsUp() ? this.thumbsT + dt : 0;
          if (this.thumbsT > 1.2) {
            this.skipLesson();
            break;
          }
        }
        if (state.controllersInHand && this.noHandsT > 1) this.caption.show('Put your controllers down', 'Shadowplay is played with your bare hands');
        else if (state.settings.look) {
          const c = this.order[this.idx];
          this.caption.show(`Make a ${c.name}`, this.phaseT > 20 ? 'Or look here to skip it' : 'Or look at its outline to wake it');
        } else if (this.noHandsT > 5) this.caption.show('Hands into the light', 'Your shadow appears on the wall');
        else if (hasHands) {
          const c = this.order[this.idx];
          const sub = this.phaseT > 30 ? 'Stuck? Hold a thumbs-up to skip' : this.phaseT > 12 ? c.hint : '';
          this.caption.show(`Make a ${c.name}`, sub);
        }
        break;
      case 'awaken':
        if (this.phaseT > 3.2) {
          this.title.hide();
          // After the first creature, the Lantern tells its first story.
          if (this.storyOn && !this.toldThisSession) {
            this.setPhase('story');
            break;
          }
          this.idx = this.nextUncollected(this.idx + 1);
          this.setPhase(this.idx < 0 ? 'free' : 'seek');
        }
        break;
      case 'free':
        this.tickMatch(dt, 'free');
        if (state.settings.look && this.storyOn && this.phaseT > 2.5) this.caption.show('Look here for another story', 'or look at a creature to wake it');
        else if (this.phaseT > 8) this.caption.hide();
        if (this.storyOn && this.phaseT > 2.5) {
          // Hands-only request: hold a thumbs-up for another story.
          this.thumbsT = thumbsUp() ? this.thumbsT + dt : 0;
          if (this.thumbsT > 1.0) this.setPhase('story');
        }
        break;
      case 'story':
        if (this.story.phase === 'asking') this.tickStoryAsk(dt);
        break;
    }

    audio.listen(state.head, stage);
    this.updateMouth();
    this.updateLook(dt);
    this.animate(dt, time);
    this.updateGhost(dt);
    this.story.update(dt, r.wallMat);
    this.theatre!.lanternSway[0] = this.story.fx.sway[0];
    this.theatre!.lanternSway[1] = this.story.fx.sway[1];

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
    const want = this.storyWant;
    const visTarget = this.phase === 'seek' || want ? 1 : 0;
    this.outlineVis += (visTarget - this.outlineVis) * Math.min(1, dt * 3);
    this.flash = Math.max(0, this.flash - dt * 1.6);
    const u = r.wallMat.uniforms;
    u.uTX.value.set(this.ox, this.oy, this.os, this.oa);
    u.uTMirror.value = this.om;
    u.uTVis.value = this.outlineVis;
    const thr = this.threshold(this.phase === 'story' ? want ?? undefined : this.order[Math.max(0, this.idx)]);
    u.uGlow.value = Math.max(0, Math.min(1, (this.iouSmooth - 0.3) / (thr - 0.3)));
    u.uFlash.value = this.flash;

    this.title.update(dt);
    this.caption.update(dt);
    duet.tick(dt, this.stageOf, this.sceneOf);
  }

  // --- two players ------------------------------------------------------------------

  /** The host's wall lighting, for the friend's wall (the order wire.ts expects). */
  private readonly stageOf = (o: Float32Array): void => {
    const u = this.theatre!.shadows.wallMat.uniforms;
    const v4 = (v: { x: number; y: number; z: number; w: number }, at: number) => {
      o[at] = v.x;
      o[at + 1] = v.y;
      o[at + 2] = v.z;
      o[at + 3] = v.w;
    };
    v4(u.uSky.value, 0);
    v4(u.uWeather.value, 4);
    o[8] = u.uMoon.value.x;
    o[9] = u.uMoon.value.y;
    o[10] = u.uMoonLit.value;
    o[11] = u.uSway.value.x;
    o[12] = u.uSway.value.y;
    o[13] = u.uPool.value.w;
    v4(u.uTX.value, 14);
    o[18] = u.uTMirror.value;
    o[19] = u.uTVis.value;
    o[20] = u.uGlow.value;
    o[21] = u.uFlash.value;
    v4(u.uGaze.value, 22);
    o[26] = u.uGazeDot.value.x;
    o[27] = u.uGazeDot.value.y;
    o[28] = u.uGazeDot.value.z;
  };

  /** The words on the host's wall and the outline showing, for the friend's wall. */
  private readonly sceneOf = (): Scene => ({
    t: 'scene',
    title: this.title.snapshot(),
    caption: this.caption.snapshot(),
    captionY: this.phase === 'story' ? 0.64 : 0.47,
    line: this.story.panel.snapshot(),
    target: this.theatre!.shadows.targetId,
  });

  /**
   * A friend's theatre: the stage, the creatures, the words and the sounds
   * all come from the host; this wall adds the friend's own shadows (and
   * sends them over, for the host's game to match).
   */
  private updateGuest(dt: number, stage: Stage): void {
    const r = this.theatre!.shadows;
    const sc = duet.scene;
    this.title.place(stage, 0, 0.62);
    this.caption.place(stage, 0, sc?.captionY ?? 0.47);
    this.story.panel.place(stage, 0, 0.56);
    if (duet.status === 'lost' || duet.status === 'error') {
      this.title.hide();
      this.caption.show(duet.status === 'lost' ? 'The theatre has closed' : "Couldn't join the theatre", duet.status === 'lost' ? 'Its host has gone. Reload to join again.' : duet.detail);
    } else if (sc) {
      this.title.mirror(sc.title);
      this.caption.mirror(sc.caption);
      if (this.story.panel.mirror(sc.line) && voice.on) voice.speak(sc.line[0], (i) => this.story.panel.follow(i));
      if (sc.target !== this.mirrorTarget) {
        this.mirrorTarget = sc.target;
        r.setTarget(sc.target ? this.targets.get(sc.target) ?? null : null);
      }
    } else this.caption.show('Joining the theatre…', `Code ${duet.code}`);
    if (duet.stageFresh) {
      duet.stageFresh = false;
      const s = duet.stage;
      const u = r.wallMat.uniforms;
      u.uSky.value.set(s[0], s[1], s[2], s[3]);
      u.uWeather.value.set(s[4], s[5], s[6], s[7]);
      u.uMoon.value.set(s[8], s[9]);
      u.uMoonLit.value = s[10];
      u.uSway.value.set(s[11], s[12]);
      // s[13] is the host's lantern brightness: each wall keeps its own lantern's.
      u.uTX.value.set(s[14], s[15], s[16], s[17]);
      u.uTMirror.value = s[18];
      u.uTVis.value = s[19];
      u.uGlow.value = s[20];
      u.uFlash.value = s[21];
      u.uGaze.value.set(s[22], s[23], s[24], s[25]);
      u.uGazeDot.value.set(s[26], s[27], s[28]);
      this.theatre!.lanternSway[0] = s[11];
      this.theatre!.lanternSway[1] = s[12];
    }
    this.title.update(dt);
    this.caption.update(dt);
    this.story.panel.update(dt);
    this.ghost.hide();
    this.ghost.update(dt);
    this.updatePlayerHands(dt);
    audio.listen(state.head, stage);
    duet.tick(dt, this.stageOf, this.sceneOf);
  }

  /** Moves past the creature being taught; it waits in free play. */
  private skipLesson(): void {
    this.caption.show('Skipped', 'It will wait for you in free play');
    this.skipped.add(this.order[this.idx].id);
    this.idx = this.nextUncollected(this.idx + 1);
    this.setPhase(this.idx < 0 ? 'free' : 'seek');
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
    const id = this.phase === 'story' ? this.storyWant?.id ?? 'bird' : this.order[Math.max(0, this.idx)]?.id ?? 'bird';
    const t = this.targets.get(id);
    return (t?.scale0 ?? 0.25) * (state.magnification / 2.6);
  }

  /** Seconds spent close-but-not-quite on the current creature. */
  private struggleT = 0;

  private threshold(c: CreatureDef | undefined): number {
    const base = TOLERANCE_IOU[state.settings.tolerance];
    // Adaptive assist: if the player hovers near the bar, lower it gently
    // (up to 0.08 over ~25 s, twice as fast with gentle shapes) instead of letting them get frustrated.
    const assist = Math.min(0.08, this.struggleT * (state.settings.gentle ? 0.0064 : 0.0032));
    return (c && c.difficulty === 3 ? base - 0.06 : base) - assist;
  }

  /**
   * Scores the player's shadow. `seek`: against the one creature being
   * taught. `free`: against the menagerie. `story`: against the creature the
   * story asked for, though another creature the player knows can answer
   * instead (it must be unmistakable), or against everyone for "any".
   */
  private tickMatch(dt: number, mode: 'seek' | 'free' | 'story'): void {
    const several = mode !== 'seek';
    const want = mode === 'story' ? this.storyWant : null;
    this.matchClock += dt;
    const interval = several ? 1 / 8 : 1 / 12;
    if (this.matchClock >= interval) {
      this.matchClock = 0;
      let bestIou = 0;
      let secondIou = 0;
      let bestRes: MatchResult | null = null;
      let bestDef: CreatureDef | null = null;
      let bestSrc = 0;
      // The player's shadow, and in two-player mode the friend's: each is scored on its own.
      const sources = duet.connected && state.remoteSegCount > 0 ? 2 : 1;
      if (state.handSegCount > 0 || sources === 2) {
        const pool =
          mode === 'seek'
            ? [this.order[this.idx]]
            : mode === 'free'
              ? this.order.filter((c) => this.collected.has(c.id) || this.skipped.has(c.id))
              : want
                ? [want, ...this.order.filter((c) => c !== want && this.collected.has(c.id))]
                : this.order;
        const targets = this.poolTargets;
        targets.length = 0;
        for (const c of pool) targets.push(this.targets.get(c.id)!);
        targets.push(...this.decoys);
        for (let src = 0; src < sources; src++) {
          const count = src === 0 ? state.handSegCount : state.remoteSegCount;
          const results = count > 0 ? this.matcher.matchAll(src === 0 ? state.handSegs : state.remoteSegs, count, targets) : null;
          if (!results) continue;
          let decoy = 0;
          for (let i = pool.length; i < targets.length; i++) decoy = Math.max(decoy, results[i].iou);
          let first = 0;
          let second = 0;
          let firstAt = -1;
          for (let i = 0; i < pool.length; i++) {
            const c = pool[i];
            const res = results[i];
            // A hand that looks more like a resting hand than this creature wakes nobody.
            // The creature being taught or asked for gets some benefit of the doubt.
            const taught = mode === 'seek' || c === want;
            let v = res.iou > decoy - (taught ? 0.05 : 0) ? res.iou : Math.min(res.iou, 0.45);
            // The joints must agree with the shape: an open hand isn't a rabbit, a fist isn't a bird.
            // (A friend's joints stay on their device; how straight their fingers are comes with their shadow.)
            const shape = this.fingers.get(c.id);
            const fits = !shape || (src === 0 ? state.hands.some((h) => h.tracked && fingersFit(shape, h.joints)) : this.friendFits(shape));
            if (!fits) v = Math.min(v, 0.45);
            if (v > first) {
              second = first;
              first = v;
              firstAt = i;
            } else if (v > second) second = v;
          }
          // With several candidates, an ambiguous shape (two creatures nearly tied) wakes nobody.
          if (several && first - second < 0.04) first = Math.min(first, 0.45);
          if (firstAt >= 0 && first > bestIou) {
            secondIou = Math.max(secondIou, second);
            bestIou = first;
            bestDef = pool[firstAt];
            bestRes = { ...results[firstAt], frame: { ...results[firstAt].frame } };
            bestSrc = src;
          }
        }
      }
      this.bestFriend = bestSrc === 1;
      if (several && bestDef !== this.best) this.iouSmooth *= 0.5;
      this.best = bestDef;
      this.iou = bestIou;
      this.last = bestRes;
      this.iouSmooth += (bestIou - this.iouSmooth) * 0.35;
      // rising ticks as the match builds
      const target = mode === 'seek' ? this.order[this.idx] : want;
      const thr = this.threshold(several ? bestDef ?? undefined : this.order[this.idx]);
      const level = Math.floor(Math.max(0, (this.iouSmooth - 0.3) / (thr - 0.3)) * 4);
      if (target && bestDef === target && level > this.lastTickLevel && level <= 4) audio.tick(level / 4);
      this.lastTickLevel = level;
    }
    const def = mode === 'seek' ? this.order[this.idx] : this.best;
    if (!def) return;
    if ((mode === 'seek' || def === want) && this.iouSmooth > 0.4) this.struggleT += dt;
    // In a story, an answer other than the one asked for has to be unmistakable.
    const strict = mode === 'story' && (want ? def !== want : !this.collected.has(def.id));
    const thr = this.threshold(def) + (strict ? 0.05 : 0);
    if (this.iouSmooth >= thr) this.holdT += dt;
    else this.holdT = Math.max(0, this.holdT - dt * 2);
    if (this.holdT >= (strict ? 0.9 : 0.6) && this.last) {
      if (mode === 'story') {
        this.wakeStory(def, this.last, this.bestFriend);
        this.holdT = 0;
        return;
      }
      if (mode === 'free' && !this.collected.has(def.id)) {
        // a skipped creature, finally made in free play: it joins for real
        this.wake(def, this.last, false);
        this.holdT = 0;
        return;
      }
      if (mode === 'free') {
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

  /** Whether the friend's tracked hand could be making this shape. */
  private friendFits(shape: readonly number[]): boolean {
    const t = duet.remoteTracked;
    return ((t & 1) !== 0 && straightnessFits(shape, duet.remoteStraight, 0)) || ((t & 2) !== 0 && straightnessFits(shape, duet.remoteStraight, 4));
  }

  private wake(def: CreatureDef, m: MatchResult, visitor: boolean): void {
    const lv = this.spawn(def, m);
    lv.visitor = visitor;
    if (!visitor) {
      this.collected.add(def.id);
      this.save();
      this.title.show(`${def.name}!`);
      this.caption.hide();
      this.setPhase('awaken');
    }
  }

  /** A creature wakes where the player's shadow was, with a flash and its song. */
  private spawn(def: CreatureDef, m: MatchResult): Living {
    const s = Math.max(0.5, Math.min(1.6, m.frame.scale / 0.2));
    const h = RIG_HEIGHT[def.id] ?? 0.3;
    // Canonical poses face left; a mirrored match faces right.
    const facing: 1 | -1 = m.mirror ? 1 : -1;
    const lv = this.makeLiving(def, m.frame.cx, m.frame.cy - (h * s) / 2, s, facing, 'perform');
    lv.alpha = 0;
    this.living.push(lv);
    this.flash = state.settings.calm ? 0.35 : 1;
    audio.awaken(m.frame.cx, m.frame.cy);
    audio.song(def.song, 0.15, m.frame.cx, m.frame.cy);
    if (def.id === 'wolf') audio.howl(0.7, m.frame.cx, m.frame.cy);
    return lv;
  }

  // --- story mode -----------------------------------------------------------------

  /** The answer to an ask: the creature wakes, joins tonight's cast, and the story goes on. */
  private wakeStory(def: CreatureDef, m: MatchResult, friend = false): void {
    const first = !this.collected.has(def.id);
    // Already in the tale? The newcomer takes its place.
    const old = this.onStage(def.id as CreatureId);
    const lv = this.spawn(def, m);
    lv.dest = 'stage';
    lv.spot = old ? [...old.spot] : this.stageSpot(def);
    if (old) this.exit(old, old.x);
    this.collected.add(def.id);
    this.save();
    this.title.show(`${def.name}!`);
    this.caption.hide();
    this.theatre?.shadows.setTarget(null);
    this.story.made(def.id as CreatureId, first, friend);
  }

  private tickStoryAsk(dt: number): void {
    const s = this.story;
    const want = this.storyWant;
    this.tickMatch(dt, 'story');
    if (s.phase !== 'asking') return; // a creature just answered
    if (state.settings.look) {
      // Hands-free: look at a creature (or the outline) to answer; the caption lets the ask go.
      const sub = s.askT > 24 ? 'Or look here to let it go' : want ? `Make the ${want.name}, or look at it` : 'Make a shadow, or look at a creature';
      this.caption.show(s.prompt, sub);
      return;
    }
    let sub = want ? `Make the ${want.name}` : 'Make any shadow you know';
    if (s.askT > 24) {
      sub = want && Math.floor(s.askT / 6) % 2 ? want.hint : 'Or hold a thumbs-up to let it go';
      this.thumbsT = thumbsUp() ? this.thumbsT + dt : 0;
      if (this.thumbsT > 1.2) {
        this.thumbsT = 0;
        this.caption.hide();
        this.theatre?.shadows.setTarget(null);
        s.letGo();
        return;
      }
    } else if (want && s.askT > 12) sub = want.hint;
    if (state.controllersInHand && this.noHandsT > 1) this.caption.show('Put your controllers down', 'Shadowplay is played with your bare hands');
    else if (this.noHandsT > 6) this.caption.show(s.prompt, 'Raise your hands into the light');
    else this.caption.show(s.prompt, sub);
  }

  known(): CreatureId[] {
    return [...this.collected] as CreatureId[];
  }

  onAsk(ask: Ask): Ask {
    this.iouSmooth = 0;
    this.holdT = 0;
    this.struggleT = 0;
    this.lastTickLevel = 0;
    this.best = null;
    this.thumbsT = 0;
    this.gazeT = 0;
    this.title.hide();
    // One-hand play: a call for a two-handed creature becomes "whoever comes".
    if (ask !== 'any' && !this.order.some((c) => c.id === ask)) ask = 'any';
    const r = this.theatre?.shadows;
    if (ask !== 'any') r?.setTarget(this.targets.get(ask)!);
    else r?.setTarget(null);
    const look = state.settings.look;
    const sub = ask !== 'any' ? `Make the ${CREATURE_BY_ID[ask].name}${look ? ', or look at it' : ''}` : look ? 'Make a shadow, or look at a creature' : 'Make any shadow you know';
    this.caption.show(this.story.prompt, sub);
    return ask;
  }

  showTitle(text: string, sub = ''): void {
    this.caption.hide();
    this.title.show(text, sub);
  }

  hideTitle(): void {
    this.title.hide();
  }

  private onStage(id: CreatureId): Living | undefined {
    return this.living.find((l) => l.dest === 'stage' && l.def.id === id && l.mode !== 'leave' && !l.visitor);
  }

  direct(who: CreatureId, does: Action): boolean {
    const lv = this.onStage(who);
    if (!lv) return false;
    if (lv.mode !== 'story') lv.pending = does; // still arriving: it acts when it gets there
    else this.startAct(lv, does);
    return true;
  }

  keepsake(k: Keepsake): void {
    this.garland.add(k);
    audio.sparkle(4);
  }

  curtainCall(): void {
    let k = 0;
    for (const lv of this.living) {
      if (lv.dest !== 'stage' || lv.mode === 'leave' || lv.visitor) continue;
      lv.curtain = true;
      if (lv.mode === 'story') {
        this.startAct(lv, 'bow');
        lv.actT = -0.35 * k++; // one after another
      } else lv.pending = 'bow';
    }
  }

  /** A free spot on the story stage, along the ground line. */
  private stageSpot(def: CreatureDef): [number, number, number] {
    const taken = this.living.filter((l) => l.dest === 'stage' && l.mode !== 'leave' && !l.visitor).map((l) => l.spot[0]);
    const x = STAGE_X.find((c) => !taken.some((t) => Math.abs(t - c) < 0.14)) ?? STAGE_X[taken.length % STAGE_X.length];
    const lift = def.id === 'butterfly' ? 0.22 : def.id === 'bird' ? 0.12 : 0;
    const s = def.id === 'deer' ? 0.6 : def.id === 'crocodile' ? 0.62 : 0.76;
    return [x, -0.44 + lift, s];
  }

  private startAct(lv: Living, does: Action): void {
    lv.act = does;
    lv.actT = 0;
    const x = lv.spot[0];
    switch (does) {
      case 'walk':
        lv.actFrom = x;
        lv.actTo = Math.abs(x) > 0.45 ? x * 0.4 : x >= 0 ? 0.72 : -0.72;
        lv.pose = 'stand';
        break;
      case 'run':
        lv.actFrom = x;
        lv.actTo = Math.max(-0.9, Math.min(0.9, Math.abs(x) > 0.2 ? -x * 0.9 : 0.75));
        lv.pose = 'stand';
        break;
      case 'sleep':
        lv.pose = 'sleep';
        lv.act = null;
        break;
      case 'hide':
        lv.pose = 'hide';
        lv.spot[0] = Math.max(-0.95, Math.min(0.95, x + (x >= 0 ? 0.1 : -0.1)));
        lv.act = null;
        break;
      case 'fly':
        if (canFly(lv.def.id as CreatureId)) {
          lv.pose = 'fly';
          lv.act = null;
        } // the others leap
        break;
      case 'look':
        lv.facing = lv.facing === 1 ? -1 : 1;
        break;
      case 'call':
        if (lv.pose === 'sleep') lv.pose = 'stand';
        this.callOut(lv.def, lv.x, lv.y + ((RIG_HEIGHT[lv.def.id] ?? 0.3) * lv.s) / 2);
        break;
      case 'leave':
        lv.act = null;
        this.exit(lv, x >= 0 ? 1.45 : -1.45);
        break;
      default: // hop, dance, bow
        if (lv.pose !== 'fly') lv.pose = 'stand';
    }
  }

  /** Off it goes (towards `toX`), fading; gone for good afterwards. */
  private exit(lv: Living, toX: number): void {
    lv.mode = 'leave';
    lv.visitor = true;
    lv.modeT = 0;
    lv.fromX = lv.x;
    lv.fromY = lv.y;
    lv.fromS = lv.s;
    lv.toX = toX;
    lv.toY = lv.y;
    lv.toS = lv.s;
    if (toX !== lv.x) lv.facing = toX > lv.x ? 1 : -1;
  }

  /** The curtain call is over: home to the shelf (or, if a twin already lives there, away). */
  private goHome(lv: Living): void {
    lv.curtain = false;
    lv.dest = 'home';
    lv.act = null;
    lv.pose = 'stand';
    const twin = this.living.some((o) => o !== lv && o.def === lv.def && o.mode === 'home' && !o.visitor);
    const home = this.homeOf(lv.def);
    if (twin) {
      this.exit(lv, home[0]);
      return;
    }
    lv.mode = 'travel';
    lv.modeT = 0;
    lv.fromX = lv.x;
    lv.fromY = lv.y;
    lv.fromS = lv.s;
    [lv.toX, lv.toY, lv.toS] = home;
    lv.facing = lv.toX >= lv.x ? 1 : -1;
  }

  /** A creature on stage calls out, from where it stands. */
  private callOut(def: CreatureDef, x: number, y: number): void {
    if (def.id === 'bird') {
      audio.chirp(1, x, y);
      setTimeout(() => audio.chirp(1.1, x, y), 180);
    } else if (def.id === 'dog') {
      audio.bark(x, y);
      setTimeout(() => audio.bark(x, y), 260);
    } else if (def.id === 'wolf') audio.howl(0.8, x, y);
    else if (def.id === 'crocodile') {
      audio.snap(x, y);
      setTimeout(() => audio.snap(x, y), 220);
    } else audio.song(def.song, 0.13, x, y);
  }

  /** One frame of a story creature: its spot, its pose, and whatever it's acting out. */
  private animateStory(lv: Living, dt: number): void {
    lv.actT += dt;
    const [sx, sy, ss] = lv.spot;
    let x = sx;
    let y = sy;
    let s = ss;
    let gait = 0;
    let alpha = 1;
    lv.action = Math.max(0, lv.action - dt * 1.5);
    lv.lift += ((lv.pose === 'fly' ? 1 : 0) - lv.lift) * Math.min(1, dt * 2);
    y += lv.lift * (0.2 + 0.02 * Math.sin(lv.modeT * 2.3));
    if (lv.pose === 'fly') gait = dt * 2.2;
    if (lv.pose === 'sleep') {
      alpha = 0.8;
      s *= 0.97 + 0.012 * Math.sin(lv.modeT * 1.6);
    }
    if (lv.pose === 'hide') alpha = 0.3;
    const k = lv.actT;
    switch (lv.act) {
      case 'walk':
      case 'run': {
        const dur = lv.act === 'run' ? 1.5 : 2.6;
        const p = Math.min(1, Math.max(0, k) / dur);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        x = lv.actFrom + (lv.actTo - lv.actFrom) * e;
        lv.facing = lv.actTo >= lv.actFrom ? 1 : -1;
        gait = dt * (lv.act === 'run' ? 2.4 : 1.3);
        if (lv.act === 'run') y += Math.abs(Math.sin(p * Math.PI * 4)) * 0.02;
        if (p >= 1) {
          lv.spot[0] = lv.actTo;
          lv.act = null;
        }
        break;
      }
      case 'hop':
        y += Math.abs(Math.sin((k / 0.55) * Math.PI)) * 0.065;
        gait = dt;
        if (k > 1.65) lv.act = null;
        break;
      case 'dance':
        y += Math.abs(Math.sin((k / 0.42) * Math.PI)) * 0.045;
        lv.facing = Math.floor(k / 0.42) % 2 ? 1 : -1;
        gait = dt * 1.6;
        if (k > 2.6) {
          lv.act = null;
          lv.facing = sx > 0 ? -1 : 1;
        }
        break;
      case 'fly': // a creature that can't fly leaps
        y += Math.sin(Math.min(1, k / 0.9) * Math.PI) * 0.16;
        gait = dt * 1.5;
        if (k > 0.9) lv.act = null;
        break;
      case 'call':
        lv.action = 0.5 + 0.5 * Math.sin(k * 11);
        if (k > 1.4) lv.act = null;
        break;
      case 'look':
        if (k > 2.2) {
          lv.facing = lv.facing === 1 ? -1 : 1;
          lv.act = null;
        }
        break;
      case 'bow': {
        const p = Math.min(1, Math.max(0, k) / 1.3);
        y -= Math.sin(p * Math.PI) * 0.035;
        lv.action = Math.sin(p * Math.PI);
        if (k > 1.3) {
          lv.act = null;
          if (lv.curtain) this.goHome(lv);
        }
        break;
      }
    }
    if (lv.mode !== 'story') return; // went home
    lv.x = x;
    lv.y = y;
    lv.s = s;
    lv.t += gait;
    lv.alpha += (alpha - lv.alpha) * Math.min(1, dt * 3);
  }

  // ---------------------------------------------------------------------------------

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
      dest: 'home',
      spot: [x, y, s],
      act: null,
      actT: 0,
      actFrom: x,
      actTo: x,
      pending: null,
      pose: 'stand',
      lift: 0,
      curtain: false,
    };
  }

  private readonly home3: [number, number, number] = [0, 0, 0];

  /**
   * A creature's place on the shelf along the bottom rim of the light pool:
   * centred on however many creatures there are (so a small menagerie sits
   * in the brightest light), in the creatures' own order. Shared result: copy it.
   */
  private homeOf(def: CreatureDef): [number, number, number] {
    let i = 0;
    let n = 0;
    for (const c of CREATURES) {
      if (!this.collected.has(c.id)) continue;
      if (c === def) i = n;
      n++;
    }
    const x = (i - (Math.max(1, n) - 1) / 2) * 0.19;
    const y = HOME_Y + 0.22 * Math.pow(x / 0.8, 2); // the rim curves up at the sides
    const lift = def.id === 'butterfly' ? 0.16 : def.id === 'bird' ? 0.06 : 0;
    const h = this.home3;
    h[0] = x;
    h[1] = y + lift;
    h[2] = def.id === 'deer' ? 0.3 : def.id === 'crocodile' ? 0.32 : 0.38;
    return h;
  }

  private animate(dt: number, _time: number): void {
    const w = this.writer;
    w.n = 0;
    // Hands-free players choose from the shelf, so it lights up while the story asks.
    const choosing = state.settings.look && this.phase === 'story' && this.story.phase === 'asking';
    const dimTo = this.phase === 'story' && !choosing ? 0.3 : 1;
    this.shelfLift += ((choosing || (state.settings.look && this.phase === 'free') ? 0.12 : 0) - this.shelfLift) * Math.min(1, dt * 2);
    this.shelfDim += (dimTo - this.shelfDim) * Math.min(1, dt * 1.5);
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
              [lv.toX, lv.toY, lv.toS] = lv.dest === 'stage' ? lv.spot : this.homeOf(lv.def);
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
          if (lv.mode === 'leave') lv.alpha = Math.min(lv.alpha, 1 - Math.max(0, (k - 0.6) / 0.4));
          if (k >= 1) {
            const leaving = lv.mode === 'leave';
            if (leaving) lv.alpha = 0;
            lv.mode = !leaving && lv.dest === 'stage' ? 'story' : 'home';
            lv.modeT = 0;
            lv.t = REST_T[lv.def.id] ?? 0;
            // face the middle of the stage
            lv.facing = lv.x > 0 ? -1 : 1;
            if (lv.mode === 'story' && lv.pending) {
              this.startAct(lv, lv.pending);
              lv.pending = null;
            }
          }
          break;
        }
        case 'home': {
          // The shelf makes room when a newcomer arrives: everyone slides to their new place.
          if (!lv.visitor) {
            const [hx, hy, hs] = this.homeOf(lv.def);
            const k = Math.min(1, dt * 2);
            lv.x += (hx - lv.x) * k;
            lv.y += (hy - lv.y) * k;
            lv.s += (hs - lv.s) * k;
          }
          // mostly still, with an occasional flourish
          const moving = lv.def.id === 'bird' || lv.def.id === 'butterfly' || lv.def.id === 'swan';
          lv.t += dt * (moving ? 0.35 : 0);
          lv.nextAction -= dt;
          if (lv.nextAction < 0) {
            lv.action = 1;
            lv.nextAction = 4 + Math.random() * 6;
            if (lv.def.id === 'wolf' && Math.random() < 0.35 && this.phase !== 'story') audio.howl(0.35, lv.x, lv.y);
          }
          lv.action = Math.max(0, lv.action - dt * 1.5);
          break;
        }
        case 'story':
          this.animateStory(lv, dt);
          break;
      }
      if (lv.alpha <= 0.01) continue;
      const rig = RIGS[lv.def.id];
      const breathe = lv.mode === 'home' ? 1 + Math.sin(lv.modeT * 2 + lv.x * 7) * 0.012 : 1;
      const shelf = lv.mode === 'home' && !lv.visitor;
      const alpha = shelf ? lv.alpha * this.shelfDim : lv.alpha;
      w.begin(lv.x, lv.y + (shelf ? this.shelfLift : 0), lv.s * breathe, lv.facing, alpha);
      rig(w, lv.t, lv.action);
    }
    // The garland hangs low in the light while the show opens and when a tale ends, and up out of the way otherwise.
    const s = this.story;
    this.garland.shown =
      this.phase === 'intro' || (this.phase === 'story' && (s.opening || s.phase === 'ending')) || (this.phase === 'free' && this.phaseT < 8);
    this.garland.draw(w, dt, this.story.fx.level.wind);
    // drop finished visitors
    this.living = this.living.filter((lv) => !(lv.visitor && lv.mode === 'home'));
    state.creatureSegCount = w.n;
  }

  /**
   * The ghost hand teaches the first creature straight away, and steps in
   * for later ones when the player seems stuck. It bows out as soon as the
   * player's shadow gets close. In a story it shows creatures the player
   * hasn't made before.
   */
  private updateGhost(dt: number): void {
    const want = this.storyWant;
    const c = this.phase === 'seek' ? this.order[this.idx] : want;
    const t = this.phase === 'story' ? this.story.askT : this.phaseT;
    const firstTime = (want ? !this.collected.has(want.id) : this.collected.size === 0) && t > 1.5;
    const stuck = t > (state.settings.gentle ? 3.5 : 7) && this.iouSmooth < 0.45;
    if (c && (this.showGhost || ((firstTime || stuck) && this.iouSmooth < 0.5))) {
      this.ghost.show(c);
      if (want) this.story.helped = true;
    } else this.ghost.hide();
    this.ghost.update(dt);
    this.updatePlayerHands(dt);
  }

  /** In the headset the player sees their real hands; on a screen we draw them. */
  private updatePlayerHands(dt: number): void {
    if ((state.virtualWall || this.showPlayerHands) && state.handSegCount > 0) this.playerHands.show(this.order[0]);
    else this.playerHands.hide();
    this.playerHands.update(dt);
  }

  // --- look to choose (hands-free) ---------------------------------------------------

  /**
   * Where the player is looking on the wall (wall metres): along the head's
   * gaze in the headset, under the pointer on a screen. False when the gaze
   * misses the wall.
   */
  private gazePoint(out: [number, number]): boolean {
    const st = state.stage;
    if (!st) return false;
    const O = this.rayO;
    const D = this.rayD;
    if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
      const H = state.head.position;
      const F = state.head.forward;
      O.set(H[0], H[1], H[2]);
      D.set(F[0], F[1], F[2]);
    } else {
      if (this.pointer.t < 0 || performance.now() - this.pointer.t > 5000) return false;
      const cam = this.world.camera;
      cam.getWorldPosition(O);
      D.set(this.pointer.x, this.pointer.y, 0.5).unproject(cam).sub(O).normalize();
    }
    const N = st.wallNormal;
    const W = st.wallPoint;
    const dn = D.x * N[0] + D.y * N[1] + D.z * N[2];
    if (dn > -0.05) return false; // looking along the wall, or away from it
    const t = ((W[0] - O.x) * N[0] + (W[1] - O.y) * N[1] + (W[2] - O.z) * N[2]) / dn;
    if (t <= 0) return false;
    const px = O.x + D.x * t - W[0];
    const py = O.y + D.y * t - W[1];
    const pz = O.z + D.z * t - W[2];
    const R = st.wallRight;
    const U = st.wallUp;
    out[0] = px * R[0] + py * R[1] + pz * R[2];
    out[1] = px * U[0] + py * U[1] + pz * U[2];
    return true;
  }

  /**
   * Look to choose: every hand interaction has a hands-free twin. Looking at
   * an outline wakes it, looking at a creature on the shelf calls it into the
   * story (or wakes it in free play), and looking at the caption does what a
   * held thumbs-up would. A gold ring fills while the player looks.
   */
  private updateLook(dt: number): void {
    const u = this.theatre!.shadows.wallMat.uniforms;
    const ring = u.uGaze.value as Vector4;
    const dot = u.uGazeDot.value as Vector3;
    const looking = state.settings.look && this.gazePoint(this.gazeXY);
    this.gazeShown += ((looking ? 1 : 0) - this.gazeShown) * Math.min(1, dt * 4);
    dot.set(this.gazeXY[0], this.gazeXY[1], this.gazeShown * 0.6);
    let kind: GazeKind | null = null;
    let of: Living | null = null;
    let cx = 0;
    let cy = 0;
    let rad = 0;
    if (looking) {
      const [gx, gy] = this.gazeXY;
      const asking = this.phase === 'story' && this.story.phase === 'asking';
      const captionY = this.phase === 'story' ? 0.64 : 0.47;
      const captionAct =
        (this.phase === 'seek' && this.phaseT > 20) || (asking && this.story.askT > 24) || (this.phase === 'free' && this.storyOn && this.phaseT > 2.5);
      if (captionAct && Math.abs(gx) < 0.5 && Math.abs(gy - captionY) < 0.11) {
        kind = 'caption';
        cx = gx;
        cy = gy;
        rad = 0.045;
      } else if (this.phase === 'seek' || (asking && this.storyWant && this.outlineVis > 0.5)) {
        const reach = Math.max(0.16, this.os);
        if (Math.hypot(gx - this.ox, gy - this.oy) < reach) {
          kind = 'outline';
          cx = this.ox;
          cy = this.oy;
          rad = Math.max(0.14, this.os * 0.9);
        }
      }
      if (!kind && (asking || this.phase === 'free')) {
        let best = 0.11;
        for (const lv of this.living) {
          if (lv.mode !== 'home' || lv.visitor || lv.alpha < 0.5) continue;
          const y = lv.y + this.shelfLift + ((RIG_HEIGHT[lv.def.id] ?? 0.3) * lv.s) / 2;
          const d = Math.hypot(gx - lv.x, gy - y);
          if (d < best) {
            best = d;
            of = lv;
            cx = lv.x;
            cy = y;
            rad = 0.09;
          }
        }
        if (of) kind = 'shelf';
      }
    }
    if (kind !== this.gazeKind || of !== this.gazeOf) {
      this.gazeKind = kind;
      this.gazeOf = of;
      this.gazeT = 0;
    } else if (kind) this.gazeT += dt;
    const p = kind ? Math.max(0, this.gazeT) / (kind === 'caption' ? DWELL_CAPTION : DWELL) : 0;
    ring.set(cx, cy, kind ? rad : 0, Math.min(1, p));
    const level = Math.floor(p * 4);
    if (kind && level > this.gazeLevel && level <= 4) audio.tick(level / 4);
    this.gazeLevel = kind ? level : 0;
    if (kind && p >= 1) {
      this.gazeT = -0.8; // a beat before the next choice can begin
      this.chooseByLook(kind, of);
    }
  }

  private gazeLevel = 0;

  private chooseByLook(kind: GazeKind, lv: Living | null): void {
    const asking = this.phase === 'story' && this.story.phase === 'asking';
    if (kind === 'caption') {
      if (this.phase === 'free') this.setPhase('story');
      else if (this.phase === 'seek') this.skipLesson();
      else if (asking) {
        this.caption.hide();
        this.theatre?.shadows.setTarget(null);
        this.story.letGo();
      }
      return;
    }
    if (kind === 'outline') {
      const def = this.phase === 'seek' ? this.order[this.idx] : this.storyWant;
      if (!def) return;
      const m = lookMatch(this.ox, this.oy, this.os);
      if (this.phase === 'seek') this.wake(def, m, false);
      else this.wakeStory(def, m);
      return;
    }
    if (!lv) return;
    const m = lookMatch(lv.x, lv.y + this.shelfLift + ((RIG_HEIGHT[lv.def.id] ?? 0.3) * lv.s) / 2, 0.1);
    if (asking) this.wakeStory(lv.def, m);
    else if (this.phase === 'free') {
      const cd = this.cooldown.get(lv.def.id) ?? 0;
      if (performance.now() / 1000 > cd) {
        this.cooldown.set(lv.def.id, performance.now() / 1000 + 5);
        this.wake(lv.def, m, true);
      }
    }
  }

  /** Talking shadows: open the beak to chirp, drop the jaw to bark. */
  private updateMouth(): void {
    const asking = this.phase === 'story' && this.story.phase === 'asking';
    const def = this.phase === 'free' || asking ? this.best : this.phase === 'seek' ? this.order[this.idx] : null;
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
      // the sound comes from the shadow itself
      const x = this.last?.frame.cx ?? 0;
      const y = this.last?.frame.cy ?? 0;
      if (def.id === 'bird') audio.chirp(0.9 + Math.random() * 0.2, x, y);
      else if (def.id === 'dog') audio.bark(x, y);
      else if (def.id === 'wolf') audio.howl(0.8, x, y);
      else audio.snap(x, y);
      if (asking) this.story.calls++;
    }
    this.mouthOpen = open;
  }

  /** A player has just arrived (headset on, or webcam started): open the show with their current settings. */
  restartIntro(): void {
    if (this.phase === 'intro' || this.phase === 'idle') this.phase = 'idle';
  }

  /** Forget the menagerie (menu action). */
  reset(): void {
    this.story.stop();
    this.toldThisSession = false;
    this.collected.clear();
    this.skipped.clear();
    this.living = [];
    this.save();
    this.phase = 'idle';
  }
}

/** A choice made by looking, shaped like a match so the creature wakes just as it would for a shadow. */
function lookMatch(cx: number, cy: number, scale: number): MatchResult {
  return { iou: 1, angle: 0, mirror: cx < 0, frame: { cx, cy, scale, area: scale * scale } };
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
