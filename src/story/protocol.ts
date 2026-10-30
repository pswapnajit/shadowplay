/**
 * The story protocol, shared by the game and the story server.
 *
 * The Lantern (Claude) tells a story one beat at a time. A beat is a JSON
 * script: narration lines, stage cues and creature actions in performance
 * order, then either a call for the next shadow or the end of the tale. The
 * player answers with a structured event (what they made, how long it took),
 * never free text, so the endpoint can't be used as a general chatbot.
 */

export const CREATURE_IDS = ['bird', 'rabbit', 'dog', 'wolf', 'fox', 'swan', 'crocodile', 'deer', 'butterfly'] as const;
export type CreatureId = (typeof CREATURE_IDS)[number];

/** Stage cues: each changes the wall's light and sound. */
export const CUES = ['night', 'moon', 'stars', 'wind', 'rain', 'snow', 'thunder', 'fireflies', 'dawn', 'calm'] as const;
export type Cue = (typeof CUES)[number];

/** What a creature already on stage can be told to do. */
export const ACTIONS = ['walk', 'run', 'hop', 'fly', 'sleep', 'hide', 'dance', 'call', 'look', 'bow', 'leave'] as const;
export type Action = (typeof ACTIONS)[number];

export type Ask = CreatureId | 'any';

export const DAYPARTS = ['morning', 'afternoon', 'evening', 'night'] as const;
export type Daypart = (typeof DAYPARTS)[number];
export function daypartOf(hour: number): Daypart {
  return hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'night';
}

export type Step = { say: string } | { cue: Cue } | { who: CreatureId; does: Action };
export type Next = { ask: Ask; prompt: string } | { end: string; summary: string };
export interface Beat {
  script: Step[];
  next: Next;
}

export type StoryEvent =
  /**
   * A story begins. `known`: creatures the player has woken before. `tales`:
   * stories told before tonight. `daypart`: the player's local time of day.
   */
  | { type: 'open'; known: CreatureId[]; tales: number; daypart?: Daypart }
  /** The player made a creature in answer to an ask. */
  | { type: 'made'; asked: Ask; made: CreatureId; seconds: number; helped: boolean; calls: number; first: boolean }
  /** Nobody came: the player let the ask go (thumbs-up) or time ran out. */
  | { type: 'none'; asked: Ask; seconds: number };

/** An earlier beat as the server returned it, signed so it can't be forged. */
export interface SignedTurn {
  content: unknown[];
  sig: string;
}
/** A finished tale for the Book of Shadows; signed tales can be recalled on later nights. */
export interface SignedTale {
  title: string;
  summary: string;
  sig: string;
}
export interface StoryRequest {
  v: 1;
  /** events[0] is 'open'; events[i] answers turns[i - 1]. Always one more event than turns. */
  events: StoryEvent[];
  turns: SignedTurn[];
  /** Up to three earlier tales, oldest first. */
  saga?: SignedTale[];
}

/** Newline-delimited JSON events streamed back by the server. */
export type ServerEvent =
  | { type: 'step'; step: Step }
  | { type: 'next'; next: Next }
  | { type: 'turn'; turn: SignedTurn; tale?: SignedTale }
  | { type: 'error'; code: 'rate' | 'invalid' | 'unavailable' | 'refusal' | 'cut' | 'off'; message: string }
  | { type: 'done'; ms: number; model?: string };

export const LIMITS = {
  /** Asks answered before the story must end. */
  maxTurns: 7,
  sayChars: 240,
  promptChars: 80,
  titleChars: 60,
  summaryChars: 240,
  sagaTales: 3,
  bodyBytes: 400_000,
  maxSeconds: 600,
};

export interface CastMember {
  id: CreatureId;
  name: string;
  /** Character notes for the narrator. */
  notes: string;
  difficulty: 1 | 2 | 3;
  canFly: boolean;
}

export const CAST: Record<CreatureId, CastMember> = {
  bird: { id: 'bird', name: 'Chatterbird', notes: 'a small songbird who chatters, gossips and sings; easy to make', difficulty: 1, canFly: true },
  rabbit: { id: 'rabbit', name: 'Rabbit', notes: 'quick and nervous, braver than it looks; easy', difficulty: 1, canFly: false },
  dog: { id: 'dog', name: 'Dog', notes: 'loyal, loud, barks at everything; medium', difficulty: 2, canFly: false },
  wolf: { id: 'wolf', name: 'Wolf', notes: 'lonely and proud, howls at the moon; medium', difficulty: 2, canFly: false },
  fox: { id: 'fox', name: 'Fox', notes: 'clever, a little vain, a trickster with a good heart; medium', difficulty: 2, canFly: false },
  swan: { id: 'swan', name: 'Swan', notes: 'graceful and proud, glides on still water; medium', difficulty: 2, canFly: true },
  crocodile: { id: 'crocodile', name: 'Crocodile', notes: 'grumpy and snappy, secretly soft-hearted; hard (two hands)', difficulty: 3, canFly: false },
  deer: { id: 'deer', name: 'Deer', notes: 'shy and gentle, with magnificent antlers; hard (two hands)', difficulty: 3, canFly: false },
  butterfly: { id: 'butterfly', name: 'Butterfly', notes: 'tiny, brave and restless, always fluttering; hard (two hands)', difficulty: 3, canFly: true },
};

const isCreature = (x: unknown): x is CreatureId => typeof x === 'string' && (CREATURE_IDS as readonly string[]).includes(x);
const isAsk = (x: unknown): x is Ask => x === 'any' || isCreature(x);
const isCue = (x: unknown): x is Cue => typeof x === 'string' && (CUES as readonly string[]).includes(x);
const isAction = (x: unknown): x is Action => typeof x === 'string' && (ACTIONS as readonly string[]).includes(x);

const obj = (props: Record<string, unknown>, required = Object.keys(props)) => ({
  type: 'object',
  properties: props,
  required,
  additionalProperties: false,
});

/** JSON schema for one beat (structured output). Property order is the order the model writes them. */
export const BEAT_SCHEMA = obj({
  script: {
    type: 'array',
    description: 'The performance, in order: narration lines with cues and actions placed exactly where they happen.',
    items: {
      anyOf: [
        obj({ say: { type: 'string', description: 'One narration line, at most 22 words.' } }),
        obj({ cue: { type: 'string', enum: [...CUES] } }),
        obj({ who: { type: 'string', enum: [...CREATURE_IDS] }, does: { type: 'string', enum: [...ACTIONS] } }),
      ],
    },
  },
  next: {
    anyOf: [
      obj({
        ask: { type: 'string', enum: [...CREATURE_IDS, 'any'], description: 'The creature the story needs next, or "any" to let the player choose.' },
        prompt: { type: 'string', description: 'A short question to the player about the story, at most nine words.' },
      }),
      obj({
        end: { type: 'string', description: "The story's title, at most six words." },
        summary: { type: 'string', description: 'One sentence that sums up the tale, for remembering it on later nights.' },
      }),
    ],
  },
});

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/** Checks a step the model wrote (or a client replayed) and tidies its text. */
export function parseStep(x: unknown): Step | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.say === 'string') {
    const say = clip(o.say, LIMITS.sayChars);
    return say ? { say } : null;
  }
  if (isCue(o.cue)) return { cue: o.cue };
  if (isCreature(o.who) && isAction(o.does)) return { who: o.who, does: o.does };
  return null;
}

export function parseNext(x: unknown): Next | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (isAsk(o.ask) && typeof o.prompt === 'string') return { ask: o.ask, prompt: clip(o.prompt, LIMITS.promptChars) };
  if (typeof o.end === 'string' && typeof o.summary === 'string') {
    return { end: clip(o.end, LIMITS.titleChars) || 'A Tale of Shadows', summary: clip(o.summary, LIMITS.summaryChars) };
  }
  return null;
}

export function parseBeat(x: unknown): Beat | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.script)) return null;
  const next = parseNext(o.next);
  if (!next) return null;
  const script = o.script.map(parseStep).filter((s): s is Step => s !== null);
  return { script, next };
}

const num = (x: unknown, max: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(max, Math.round(x))) : 0);

/** Validates one player event; anything unexpected is rejected rather than repaired. */
export function parseEvent(x: unknown): StoryEvent | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  switch (o.type) {
    case 'open': {
      if (!Array.isArray(o.known) || !o.known.every(isCreature)) return null;
      const daypart = (DAYPARTS as readonly unknown[]).includes(o.daypart) ? (o.daypart as Daypart) : undefined;
      return { type: 'open', known: [...new Set(o.known)], tales: num(o.tales, 9999), ...(daypart ? { daypart } : {}) };
    }
    case 'made':
      if (!isAsk(o.asked) || !isCreature(o.made)) return null;
      return {
        type: 'made',
        asked: o.asked,
        made: o.made,
        seconds: num(o.seconds, LIMITS.maxSeconds),
        helped: o.helped === true,
        calls: num(o.calls, 20),
        first: o.first === true,
      };
    case 'none':
      if (!isAsk(o.asked)) return null;
      return { type: 'none', asked: o.asked, seconds: num(o.seconds, LIMITS.maxSeconds) };
    default:
      return null;
  }
}

const the = (id: CreatureId) => `the ${CAST[id].name} (${id})`;

/**
 * The user message for an event. Deterministic: the same event at the same
 * point renders the same bytes, which keeps the prompt cache and the
 * conversation's thinking blocks valid when the history is replayed.
 */
export function renderEvent(e: StoryEvent, asksDone: number, saga: { title: string; summary: string }[] = []): string {
  if (e.type === 'open') {
    const known = e.known.length ? e.known.map(the).join(', ') : 'none yet';
    const when = e.daypart ? `It is ${e.daypart === 'night' ? 'late at night' : `the ${e.daypart}`} where the player is.` : '';
    const lines = [
      'A new story in the theatre.',
      ...(when ? [when] : []),
      `Creatures this player already knows how to make: ${known}.`,
      `Stories told in this theatre before tonight: ${e.tales}.`,
    ];
    if (saga.length) {
      lines.push('Earlier tales, oldest first:');
      for (const t of saga) lines.push(`- "${t.title}": ${t.summary}`);
    }
    lines.push("Begin tonight's story: the opening beat, ending with your first ask.");
    return lines.join('\n');
  }
  const lines: string[] = [];
  const asked = e.asked === 'any' ? 'any creature (the player chose)' : the(e.asked);
  if (e.type === 'made') {
    const differs = e.asked !== 'any' && e.asked !== e.made;
    lines.push(`You asked for: ${asked}. The player made: ${the(e.made)}${differs ? ', not the one you asked for' : ''}.`);
    const help = e.helped ? ', with the ghost hand showing them how' : '';
    lines.push(`It took ${e.seconds} seconds${help}.${e.calls ? ` On stage it called out ${e.calls} time${e.calls === 1 ? '' : 's'}.` : ''}`);
    if (e.first) lines.push(`This is the first time this player has ever made the ${CAST[e.made].name}.`);
  } else {
    lines.push(`You asked for: ${asked}. Nobody came: after ${e.seconds} seconds the player let it go.`);
  }
  lines.push(pacing(asksDone));
  return lines.join('\n');
}

function pacing(asksDone: number): string {
  if (asksDone >= LIMITS.maxTurns - 2) return `[Ask ${asksDone} of the story is done. End the story in this beat.]`;
  if (asksDone >= 4) return `[Ask ${asksDone} is done. Bring the story to its climax; at most one more ask.]`;
  if (asksDone === 3) return '[Ask 3 is done. The story is past its middle: build toward the climax.]';
  return `[Ask ${asksDone} is done. Continue the story.]`;
}

/** Plain text of a beat (tests, logs, the offline narrator). */
export function beatText(b: Beat): string {
  return b.script.map((s) => ('say' in s ? s.say : 'cue' in s ? `[${s.cue}]` : `[${s.who} ${s.does}]`)).join(' ');
}

export const isCreatureId = isCreature;
