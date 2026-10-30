/**
 * Shadowplay for two. One player hosts the theatre; a friend joins with the
 * room code from their own wall, anywhere (another Quest, or a laptop
 * webcam). Both walls show the same stage, lit by two lanterns: the host's
 * story and creatures, the host's shadows and the friend's (theirs fall in
 * a cooler, bluer light). The host's game runs the show and the Lantern;
 * the friend's shadow can answer any ask.
 */

import { straightness } from '../core/fingers.js';
import { type Link, openLink, type Payload, type Role, type Transport } from '../net/link.js';
import {
  decodeGuestFrame,
  decodeHostFrame,
  encodeGuestFrame,
  encodeHostFrame,
  type GuestFrameOut,
  type HostEvent,
  type HostFrameOut,
  type Scene,
  STAGE_FLOATS,
} from '../net/wire.js';
import { audio } from './audio.js';
import { state } from './state.js';

export type DuetStatus = 'off' | 'opening' | 'waiting' | 'joined' | 'lost' | 'error';

/** Sounds the host's stage makes that the friend hears too (each at its own place on their wall). */
const SHARED_SOUNDS = ['awaken', 'song', 'chirp', 'bark', 'howl', 'snap', 'tick', 'thunder', 'swell', 'sparkle', 'bed'] as const;
const SEND_EVERY = 1 / 20;

class Duet {
  role: Role | null = null;
  code = '';
  status: DuetStatus = 'off';
  detail = '';
  onStatus: ((s: DuetStatus) => void) | null = null;
  /** Someone arrived on the other end (or left). */
  onPeer: ((here: boolean) => void) | null = null;

  /** Guest: the host's wall lighting, and its latest scene (words, outline). */
  readonly stage = new Float32Array(STAGE_FLOATS);
  stageFresh = false;
  scene: Scene | null = null;
  /** Host: the friend's tracked hands (bit 0 left, bit 1 right) and how straight each long finger is. */
  readonly remoteStraight = new Float32Array(8);
  remoteTracked = 0;

  private link: Link | null = null;
  private sendT = 0;
  private sceneKey = '';
  private readonly stageOut = new Float32Array(STAGE_FLOATS);
  private readonly straightOut = new Float32Array(8);
  private readonly straight4 = new Float32Array(4);
  private readonly hostIn: HostFrameOut = {
    stage: this.stage,
    creatures: state.creatureSegs,
    alphas: state.creatureAlpha,
    creatureCount: 0,
    hands: state.remoteSegs,
    handCount: 0,
  };
  private readonly guestIn: GuestFrameOut = { hands: state.remoteSegs, handCount: 0, tracked: 0, straight: this.remoteStraight };
  private shared = false;

  get connected(): boolean {
    return this.status === 'joined' && !!this.link?.connected;
  }

  get guest(): boolean {
    return this.role === 'guest';
  }

  async start(role: Role, code: string, transport: Transport): Promise<void> {
    this.close();
    this.role = role;
    this.code = code;
    this.set('opening');
    try {
      const link = await openLink(role, code, transport);
      this.link = link;
      link.onMessage = (d) => this.receive(d);
      link.onOpen = () => {
        this.set('joined');
        link.send(JSON.stringify({ t: 'hello', v: 1 }));
        this.sceneKey = '';
        if (role === 'host') this.shareSounds();
        this.onPeer?.(true);
      };
      link.onClose = () => {
        state.remoteSegCount = 0;
        this.remoteTracked = 0;
        this.set(role === 'host' ? 'waiting' : 'lost');
        this.onPeer?.(false);
      };
      if (link.connected) link.onOpen();
      else this.set(role === 'host' ? 'waiting' : 'opening');
    } catch (error) {
      this.detail = describe(error);
      this.set('error');
    }
  }

  close(): void {
    this.link?.close();
    this.link = null;
    state.remoteSegCount = 0;
    if (this.status !== 'off') this.set('off');
  }

  private set(s: DuetStatus): void {
    this.status = s;
    this.onStatus?.(s);
  }

  /**
   * Called every frame by the game. The host sends its stage, creatures and
   * hands (and the scene when it changes); the guest sends its hands.
   */
  tick(dt: number, stageOf: (out: Float32Array) => void, sceneOf: () => Scene): void {
    if (!this.connected) return;
    this.sendT += dt;
    if (this.sendT < SEND_EVERY) return;
    this.sendT = 0;
    const link = this.link!;
    if (this.role === 'host') {
      stageOf(this.stageOut);
      link.send(encodeHostFrame(this.stageOut, state.creatureSegs, state.creatureAlpha, state.creatureSegCount, state.handSegs, state.handSegCount));
      const key = JSON.stringify(sceneOf());
      if (key !== this.sceneKey) {
        this.sceneKey = key;
        link.send(key);
      }
    } else {
      let tracked = 0;
      for (let h = 0; h < 2; h++) {
        const hand = state.hands[h];
        if (!hand.tracked) continue;
        tracked |= 1 << h;
        this.straightOut.set(straightness(hand.joints, this.straight4), h * 4);
      }
      link.send(encodeGuestFrame(state.handSegs, state.handSegCount, tracked, this.straightOut));
    }
  }

  private receive(d: Payload): void {
    if (typeof d !== 'string') {
      if (this.role === 'guest' && decodeHostFrame(d, this.hostIn)) {
        state.creatureSegCount = this.hostIn.creatureCount;
        state.remoteSegCount = this.hostIn.handCount;
        this.stageFresh = true;
      } else if (this.role === 'host' && decodeGuestFrame(d, this.guestIn)) {
        state.remoteSegCount = this.guestIn.handCount;
        this.remoteTracked = this.guestIn.tracked;
      }
      return;
    }
    let m: HostEvent;
    try {
      m = JSON.parse(d) as HostEvent;
    } catch {
      return;
    }
    if (this.role !== 'guest') return;
    if (m.t === 'scene') this.scene = m;
    else if (m.t === 'sfx') playShared(m.m, m.a);
  }

  /** The host's stage sounds are heard on the friend's wall too. */
  private shareSounds(): void {
    if (this.shared) return;
    this.shared = true;
    const a = audio as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const m of SHARED_SOUNDS) {
      const own = a[m].bind(audio);
      a[m] = (...args: unknown[]) => {
        const r = own(...args);
        if (this.role === 'host' && this.connected) this.link!.send(JSON.stringify({ t: 'sfx', m, a: args }));
        return r;
      };
    }
  }
}

/** Plays a sound the host sent, if it's one of the stage's own and its arguments are plain values. */
function playShared(m: string, args: unknown): void {
  if (!(SHARED_SOUNDS as readonly string[]).includes(m) || !Array.isArray(args) || args.length > 6) return;
  const plain = (x: unknown): boolean =>
    x === undefined ||
    x === null ||
    (typeof x === 'number' && Number.isFinite(x)) ||
    (typeof x === 'string' && x.length < 16) ||
    (Array.isArray(x) && x.length <= 16 && x.every((v) => typeof v === 'number' && Number.isFinite(v)));
  if (!args.every(plain)) return;
  (audio as unknown as Record<string, (...a: unknown[]) => void>)[m](...args.map((x) => (x === null ? undefined : x)));
}

function describe(error: unknown): string {
  const type = (error as { type?: string })?.type;
  if (type === 'unavailable-id') return 'That code is already in use. Try again for a new one.';
  if (type === 'peer-unavailable') return 'No theatre is open with that code.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return "Couldn't reach the connection service. Check the internet connection.";
  return (error as Error)?.message || 'Something went wrong.';
}

export const duet = new Duet();

/** The transport for this visit: `?net=local` links tabs of one browser (tests, demos). */
export function duetTransport(): Transport {
  return new URLSearchParams(location.search).get('net') === 'local' ? 'local' : 'peer';
}
