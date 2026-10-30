/**
 * One story's conversation with the Lantern. Sends the player's events to
 * the story server, collects the beat's steps as they stream in, and keeps
 * the signed history for the next request. If the Lantern can't be reached
 * (offline, rate-limited, no key, an error mid-beat) the understudy takes
 * over for the rest of the story without a visible seam.
 */

import { OfflineTeller } from './offline.js';
import {
  type Next,
  parseNext,
  parseStep,
  type ServerEvent,
  type SignedTale,
  type SignedTurn,
  type Step,
  type StoryEvent,
} from './protocol.js';

export type Source = 'lantern' | 'understudy';

const FIRST_STEP_MS = 20_000;
const BEAT_MS = 50_000;

export class Narrator {
  readonly events: StoryEvent[] = [];
  /** Steps ready to perform, in order. */
  readonly queue: Step[] = [];
  /** The ask or ending after the queued steps, once known. */
  next: Next | null = null;
  busy = false;
  source: Source;
  /** The Lantern's signed tale, when it ended the story. */
  tale: SignedTale | null = null;
  lastError = '';
  /** Milliseconds from each request to its first step (for the debug overlay and tuning). */
  readonly latency: number[] = [];
  /** Each step as it arrives (the voice fetches lines ahead). */
  onStep: ((step: Step) => void) | null = null;
  /** The server's signature for the ending's promise, when the Lantern ended the story. */
  nextSig: string | null = null;

  private readonly turns: SignedTurn[] = [];
  private understudy: OfflineTeller | null = null;
  private catchUp = false;
  private ctrl: AbortController | null = null;
  private cancelled = false;

  constructor(
    private readonly endpoint: string | null,
    private readonly saga: SignedTale[] = [],
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
    private readonly seed = Date.now(),
  ) {
    this.source = endpoint ? 'lantern' : 'understudy';
    if (!endpoint) this.understudy = new OfflineTeller(seed);
  }

  begin(open: Extract<StoryEvent, { type: 'open' }>): void {
    this.events.length = 0;
    this.events.push(open);
    this.request();
  }

  answer(e: Exclude<StoryEvent, { type: 'open' }>): void {
    this.next = null;
    this.events.push(e);
    this.request();
  }

  /** The player left the theatre: stop any beat in flight. */
  cancel(): void {
    this.cancelled = true;
    this.ctrl?.abort();
    this.ctrl = null;
  }

  private request(): void {
    this.busy = true;
    if (this.source === 'lantern') {
      void this.fetchBeat();
      return;
    }
    const beat = this.catchUp ? this.understudy!.takeOver(this.events) : this.understudy!.beat(this.events);
    this.catchUp = false;
    this.push(beat.script);
    this.next = beat.next;
    this.busy = false;
  }

  private async fetchBeat(): Promise<void> {
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    const t0 = performance.now();
    let steps = 0;
    let next: Next | null = null;
    const turnsBefore = this.turns.length;
    const firstStep = setTimeout(() => ctrl.abort(), FIRST_STEP_MS);
    const whole = setTimeout(() => ctrl.abort(), BEAT_MS);
    try {
      const res = await this.fetchImpl(this.endpoint!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ v: 1, events: this.events, turns: this.turns, saga: this.saga }),
        signal: ctrl.signal,
      });
      if (!res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as ServerEvent;
          if (ev.type === 'step') {
            const step = parseStep(ev.step);
            if (!step) continue;
            if ('say' in step && typeof ev.sig === 'string') step.sig = ev.sig;
            if (steps++ === 0) {
              clearTimeout(firstStep);
              this.latency.push(Math.round(performance.now() - t0));
            }
            this.push([step]);
          } else if (ev.type === 'next') {
            next = parseNext(ev.next);
            this.nextSig = typeof ev.sig === 'string' ? ev.sig : null;
          }
          else if (ev.type === 'turn') {
            this.turns.push(ev.turn);
            if (ev.tale) this.tale = ev.tale;
          } else if (ev.type === 'error') throw new Error(`${ev.code}: ${ev.message}`);
        }
      }
      if (!next) throw new Error(res.ok ? 'The beat ended early.' : `HTTP ${res.status}`);
      this.next = next;
      // Without its signed turn the conversation can't go on with the Lantern.
      if (this.turns.length === turnsBefore) this.handOver(true);
    } catch (error) {
      if (this.cancelled) return;
      this.lastError = ctrl.signal.aborted ? 'timed out' : (error as Error).message;
      if (steps > 0) {
        // Part of the beat already played: the understudy only supplies what comes next.
        this.understudy = new OfflineTeller(this.seed);
        this.next = this.understudy.bridge(this.events);
        this.source = 'understudy';
      } else {
        this.handOver(false);
        const beat = this.understudy!.takeOver(this.events);
        this.catchUp = false;
        this.push(beat.script);
        this.next = beat.next;
      }
    } finally {
      clearTimeout(firstStep);
      clearTimeout(whole);
      if (this.ctrl === ctrl) this.ctrl = null;
      this.busy = false;
    }
  }

  private push(steps: Step[]): void {
    for (const s of steps) {
      this.queue.push(s);
      this.onStep?.(s);
    }
  }

  /** Switches to the understudy for the rest of the story. */
  private handOver(catchUpLater: boolean): void {
    this.source = 'understudy';
    this.understudy = new OfflineTeller(this.seed);
    this.catchUp = catchUpLater;
  }
}
