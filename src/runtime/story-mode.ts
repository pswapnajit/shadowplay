/**
 * Story mode: the Lantern tells a tale and the player casts it. This plays
 * each beat (narration on the wall, stage cues, creatures acting), turns
 * every ask into a shadow to make, and reports what the player made back to
 * the storyteller. The game (the host) does the matching and owns the
 * creatures on the wall.
 */

import type { ShaderMaterial } from '@iwsdk/core';
import { addTale, loadBook, recentSaga } from '../story/book.js';
import { Narrator } from '../story/narrator.js';
import { type Action, type Ask, CAST, type CreatureId, type Step } from '../story/protocol.js';
import { audio } from './audio.js';
import { NarrationPanel } from './narration.js';
import { StageFx } from './stage-fx.js';

export type StoryPhase = 'off' | 'telling' | 'asking' | 'ending';

export interface StoryHost {
  /** Creatures the player has woken before. */
  known(): CreatureId[];
  /** Directs a creature in tonight's cast; false if it isn't on stage. */
  direct(who: CreatureId, does: Action): boolean;
  /** A new ask: show its outline (or none for "any"). */
  onAsk(ask: Ask): void;
  /** The tale is over: the cast bows and goes home. */
  curtainCall(): void;
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
  onDone: (() => void) | null = null;

  private intro: Step[] = [];
  private step: Step | null = null;
  private stepT = 0;
  private waitT = 0;
  private endT = 0;
  /** A breath before the first words, while the intro's titles fade. */
  private holdT = 0;

  constructor(private readonly host: StoryHost) {
    // The Lantern murmurs each word: a wordless voice that rises and falls with the line.
    this.panel.onWord = (word, i, n) => {
      const h = [...word].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      const arc = Math.sin((i / Math.max(1, n - 1)) * Math.PI) * 4;
      const fall = i === n - 1 ? -3 : 0;
      audio.voice(PENT[h % 5] + arc + fall - 2);
    };
  }

  get active(): boolean {
    return this.phase !== 'off';
  }

  start(): void {
    const book = loadBook();
    this.narrator?.cancel();
    this.narrator = new Narrator(storyEndpoint(), recentSaga(book));
    this.cast = [];
    this.ask = null;
    this.step = null;
    this.title = '';
    this.phase = 'telling';
    this.waitT = 0;
    this.holdT = 1.3;
    // The Lantern's own opening words, spoken while the first beat is on its way.
    this.intro = (
      book.length === 0
        ? ['Every night, I tell a story.', 'Tonight, you cast it. Whoever you make on the wall will be in it.']
        : ['Another night, another story.', "Let's see who comes out of the dark tonight."]
    ).map((say) => ({ say }));
    this.narrator.begin({ type: 'open', known: this.host.known(), tales: book.length });
  }

  stop(): void {
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
      case 'ending':
        this.endT += dt;
        // the last line fades before the title card and the curtain call
        if (this.endT > 0.9 && this.endT - dt <= 0.9) {
          this.host.showTitle(this.title, 'The End');
          this.host.curtainCall();
          audio.song([0, 2, 4, 7, 9, 7, 4, 2, 4, 0], 0.24);
        }
        if (this.endT > 10) {
          this.phase = 'off';
          this.host.hideTitle();
          this.fx.reset();
          this.onDone?.();
        }
        break;
    }
  }

  private tell(dt: number): void {
    if (this.holdT > 0) {
      this.holdT -= dt;
      return;
    }
    if (this.step) {
      this.stepT -= dt;
      if (this.stepT > 0 || ('say' in this.step && !this.panel.done)) return;
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
      else this.end(next.end, next.summary);
      return;
    }
    // Waiting for the Lantern: after a moment, it visibly gathers its thoughts.
    this.waitT += dt;
    if (this.waitT > 0.9) {
      this.host.hideTitle();
      this.panel.setThinking(true);
    }
  }

  private perform(step: Step): void {
    this.waitT = 0;
    this.step = step;
    if ('say' in step) {
      this.host.hideTitle();
      this.stepT = 0;
      this.panel.speak(step.say);
    } else if ('cue' in step) {
      this.fx.cue(step.cue);
      this.stepT = step.cue === 'moon' || step.cue === 'dawn' ? 1.5 : step.cue === 'thunder' ? 1.3 : 0.7;
    } else {
      this.stepT = this.host.direct(step.who, step.does) ? 0.6 : 0;
    }
  }

  private beginAsk(ask: Ask, prompt: string): void {
    this.phase = 'asking';
    this.ask = ask;
    this.prompt = prompt;
    this.askT = 0;
    this.helped = false;
    this.calls = 0;
    this.fx.steady = 1;
    this.panel.hide();
    this.host.onAsk(ask);
  }

  private end(title: string, summary: string): void {
    this.phase = 'ending';
    this.endT = 0;
    this.title = title;
    this.panel.hide();
    const n = this.narrator!;
    const signed = n.source === 'lantern' && n.tale ? n.tale : null;
    addTale({
      title,
      summary,
      cast: [...this.cast],
      at: Date.now(),
      by: signed ? 'lantern' : 'understudy',
      ...(signed ? { sig: signed.sig } : {}),
    });
  }
}

/** Creatures that can't fly leap instead. */
export function canFly(id: CreatureId): boolean {
  return CAST[id].canFly;
}
