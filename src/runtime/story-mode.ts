/**
 * Story mode: the Lantern tells a tale and the player casts it. This plays
 * each beat (narration on the wall, stage cues, creatures acting), turns
 * every ask into a shadow to make, and reports what the player made back to
 * the storyteller. The game (the host) does the matching and owns the
 * creatures on the wall.
 */

import type { ShaderMaterial } from '@iwsdk/core';
import { addTale, loadBook, nightKey, nightNumber, pendingPromise, recentSaga } from '../story/book.js';
import { Narrator } from '../story/narrator.js';
import { type Action, type Ask, CAST, type CreatureId, daypartOf, type Ending, type Keepsake, moonOf, type Step } from '../story/protocol.js';
import { audio } from './audio.js';
import { NarrationPanel } from './narration.js';
import { StageFx } from './stage-fx.js';
import { state } from './state.js';
import { voice } from './voice.js';

export type StoryPhase = 'off' | 'telling' | 'asking' | 'ending';

export interface StoryHost {
  /** Creatures the player has woken before. */
  known(): CreatureId[];
  /** Directs a creature in tonight's cast; false if it isn't on stage. */
  direct(who: CreatureId, does: Action): boolean;
  /** A new ask: show its outline (or none for "any"). Returns the ask as the theatre can stage it. */
  onAsk(ask: Ask): Ask;
  /** The tale is over: the cast bows and goes home. */
  curtainCall(): void;
  /** The tale's keepsake joins the garland. */
  keepsake(k: Keepsake): void;
  showTitle(text: string, sub?: string): void;
  hideTitle(): void;
}

/** Where the story server lives. Same origin in development and on Vercel; configured for GitHub Pages. */
export const STORY_API_FOR_PAGES = '';

export function storyEndpoint(): string | null {
  const p = new URLSearchParams(location.search);
  if (p.get('narrator') === 'offline') return null;
  const override = p.get('storyapi');
  if (override) return override;
  if (location.hostname.endsWith('github.io')) return STORY_API_FOR_PAGES || null;
  return `${location.origin}/api/story`;
}

const PENT = [0, 2, 4, 7, 9];

export class StoryMode {
  phase: StoryPhase = 'off';
  readonly panel = new NarrationPanel();
  readonly fx = new StageFx();
  narrator: Narrator | null = null;
  ask: Ask | null = null;
  prompt = '';
  /** Seconds since the current ask began. */
  askT = 0;
  /** During an ask: did the ghost hand have to help, and how often did the creature call out. */
  helped = false;
  calls = 0;
  /** Creatures that have appeared in tonight's tale, in order. */
  cast: CreatureId[] = [];
  title = '';
  /** Which night this is in the theatre (the moon grows with each). */
  night = 1;
  /** Asks made so far in this tale. */
  asks = 0;
  onDone: (() => void) | null = null;
  private ending: Ending | null = null;

  private intro: Step[] = [];
  private step: Step | null = null;
  private stepT = 0;
  private waitT = 0;
  private endT = 0;
  /** A breath before the first words, while the intro's titles fade. */
  private holdT = 0;
  /** Seconds the current line has been spoken for (a voice that never ends is cut off). */
  private voiceT = 0;
  private voiceCap = 0;
  private voicedLine = false;

  constructor(private readonly host: StoryHost) {
    // The Lantern murmurs each word: a wordless voice that rises and falls with the line.
    this.panel.onWord = (word, i, n) => {
      if (voice.speaking) return; // the real voice is reading it
      const h = [...word].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      const arc = Math.sin((i / Math.max(1, n - 1)) * Math.PI) * 4;
      const fall = i === n - 1 ? -3 : 0;
      audio.voice(PENT[h % 5] + arc + fall - 2);
    };
  }

  get active(): boolean {
    return this.phase !== 'off';
  }

  /** The tale's opening, before its first ask (the keepsakes of earlier nights hang in the light). */
  get opening(): boolean {
    return this.phase === 'telling' && this.asks === 0;
  }

  start(): void {
    const book = loadBook();
    this.narrator?.cancel();
    this.narrator = new Narrator(storyEndpoint(), recentSaga(book));
    this.cast = [];
    this.ask = null;
    this.step = null;
    this.title = '';
    this.ending = null;
    this.asks = 0;
    this.phase = 'telling';
    this.waitT = 0;
    this.holdT = 1.3;
    const nowMs = Date.now();
    const daypart = daypartOf(new Date(nowMs).getHours());
    const now = daypart === 'evening' || daypart === 'night' ? 'Tonight' : 'Today';
    // Every night the player comes back, the moon over the theatre grows; it rises as the show opens.
    this.night = nightNumber(book, nowMs);
    const moon = moonOf(this.night);
    this.fx.moonLit = moon.lit;
    this.fx.cue('moon');
    const promise = pendingPromise(book, nowMs);
    // The Lantern's own opening words, spoken while the first beat is on its way.
    const last = book[book.length - 1];
    const lines: string[] = [];
    if (!last) lines.push(`Every ${daypart}, I tell a story.`, `${now}, you cast it. Whoever you make on the wall will be in it.`);
    else if (nightKey(last.at) === nightKey(nowMs)) lines.push('Another story? Of course.', "Let's see who comes out of the dark.");
    else {
      if (moon.phase === 'full') lines.push('The moon is full tonight.', 'On full-moon nights, old friends come back.');
      else lines.push(`The moon has grown. ${cardinal(moon.toFull)} more ${moon.toFull === 1 ? 'night' : 'nights'} until it's full.`);
      if (promise) lines.push('Last time, I made you a promise. Tonight, I keep it.');
      else if (moon.phase !== 'full') lines.push(`Last time, I told "${last.title}". ${now}, something new.`);
    }
    this.intro = lines.map((say) => ({ say }));
    this.narrator.begin({
      type: 'open',
      known: this.host.known(),
      tales: book.length,
      daypart,
      night: this.night,
      ...(state.settings.oneHand ? { hands: 1 as const } : {}),
      ...(promise ? { keep: promise.keep } : {}),
    });
  }

  stop(): void {
    voice.cancel();
    this.narrator?.cancel();
    this.narrator = null;
    this.phase = 'off';
    this.ask = null;
    this.step = null;
    this.panel.hide();
    this.fx.reset();
  }

  /** The player's shadow woke `id` during an ask. */
  made(id: CreatureId, first: boolean): void {
    if (this.phase !== 'asking' || !this.ask || !this.narrator) return;
    if (!this.cast.includes(id)) this.cast.push(id);
    this.narrator.answer({ type: 'made', asked: this.ask, made: id, seconds: Math.round(this.askT), helped: this.helped, calls: this.calls, first });
    this.toTelling();
    // Let the creature's wake and its name have the stage before the story goes on.
    this.holdT = 2.4;
  }

  /** The player let the ask go (thumbs-up), or nobody came in time. */
  letGo(): void {
    if (this.phase !== 'asking' || !this.ask || !this.narrator) return;
    this.narrator.answer({ type: 'none', asked: this.ask, seconds: Math.round(this.askT) });
    this.toTelling();
  }

  private toTelling(): void {
    this.ask = null;
    this.phase = 'telling';
    this.waitT = 0;
    this.fx.steady = 0;
  }

  update(dt: number, wall: ShaderMaterial): void {
    this.panel.update(dt);
    this.fx.update(dt, wall);
    switch (this.phase) {
      case 'telling':
        this.tell(dt);
        break;
      case 'asking':
        this.askT += dt;
        if (this.askT > 100) this.letGo();
        break;
      case 'ending': {
        this.endT += dt;
        const e = this.ending;
        // the last line fades before the title card, the curtain call and the keepsake
        if (this.endT > 0.9 && this.endT - dt <= 0.9) {
          this.host.showTitle(this.title, 'The End');
          this.host.curtainCall();
          if (e) this.host.keepsake(e.keepsake);
          audio.song([0, 2, 4, 7, 9, 7, 4, 2, 4, 0], 0.24);
        }
        // Then the Lantern's promise for tomorrow night.
        if (e?.tomorrow && this.endT > 5.6 && this.endT - dt <= 5.6) {
          this.host.hideTitle();
          this.sayLine(e.tomorrow);
        }
        this.followVoice(dt);
        const promised = !e?.tomorrow || (this.endT > 6 && this.panel.done && !voice.speaking);
        if ((this.endT > 10 && promised) || this.endT > 24) {
          this.phase = 'off';
          this.host.hideTitle();
          this.panel.hide();
          this.fx.reset();
          this.onDone?.();
        }
        break;
      }
    }
  }

  private tell(dt: number): void {
    if (this.holdT > 0) {
      this.holdT -= dt;
      return;
    }
    if (this.step) {
      this.stepT -= dt;
      const speaking = this.followVoice(dt);
      if (this.stepT > 0 || ('say' in this.step && (!this.panel.done || speaking))) return;
      this.step = null;
    }
    const n = this.narrator!;
    const q = this.intro.length ? this.intro : n.queue;
    if (q.length) {
      this.perform(q.shift()!);
      return;
    }
    if (n.next && !n.busy) {
      const next = n.next;
      n.next = null;
      if ('ask' in next) this.beginAsk(next.ask, next.prompt);
      else this.end(next);
      return;
    }
    // Waiting for the Lantern: after a moment, it visibly gathers its thoughts.
    this.waitT += dt;
    if (this.waitT > 0.9) {
      this.host.hideTitle();
      this.panel.setThinking(true);
    }
  }

  /** Puts a line on the wall, read aloud when the device has a voice. */
  private sayLine(text: string): void {
    const voiced = voice.on;
    this.voicedLine = voiced;
    const dur = this.panel.speak(text, voiced);
    this.voiceT = 0;
    this.voiceCap = dur * 2 + 2;
    if (voiced) voice.speak(text, (i) => this.panel.follow(i));
  }

  /** Keeps the words in step with the voice; true while it is still reading the line. */
  private followVoice(dt: number): boolean {
    this.voiceT += dt;
    const speaking = voice.speaking && this.voiceT < this.voiceCap;
    // the voice finished the line: all of it shows, and the story moves on
    if (this.voicedLine && !speaking && this.voiceT > 0.5) {
      this.voicedLine = false;
      this.panel.voiceDone();
    }
    return speaking;
  }

  private perform(step: Step): void {
    this.waitT = 0;
    this.step = step;
    if ('say' in step) {
      this.host.hideTitle();
      this.stepT = 0;
      this.sayLine(step.say);
    } else if ('cue' in step) {
      this.fx.cue(step.cue);
      this.stepT = step.cue === 'moon' || step.cue === 'dawn' ? 1.5 : step.cue === 'thunder' ? 1.3 : 0.7;
    } else {
      this.stepT = this.host.direct(step.who, step.does) ? 0.6 : 0;
    }
  }

  private beginAsk(ask: Ask, prompt: string): void {
    this.asks++;
    this.phase = 'asking';
    this.ask = ask;
    this.prompt = prompt;
    this.askT = 0;
    this.helped = false;
    this.calls = 0;
    this.fx.steady = 1;
    this.panel.hide();
    this.ask = this.host.onAsk(ask);
  }

  private end(e: Ending): void {
    this.phase = 'ending';
    this.endT = 0;
    this.title = e.end;
    this.ending = e;
    this.panel.hide();
    const n = this.narrator!;
    const signed = n.source === 'lantern' && n.tale ? n.tale : null;
    // A signed tale keeps the promise exactly as it was signed (the Lantern can be reminded of it).
    const promise = signed ? signed.promise : e.tomorrow;
    addTale({
      title: e.end,
      summary: e.summary,
      cast: [...this.cast],
      at: Date.now(),
      by: signed ? 'lantern' : 'understudy',
      keepsake: e.keepsake,
      ...(signed ? { sig: signed.sig } : {}),
      ...(promise ? { promise } : {}),
      ...(!signed && e.plan ? { plan: e.plan } : {}),
    });
  }
}

const CARDINALS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];
function cardinal(n: number): string {
  return CARDINALS[n] ?? String(n);
}

/** Creatures that can't fly leap instead. */
export function canFly(id: CreatureId): boolean {
  return CAST[id].canFly;
}
