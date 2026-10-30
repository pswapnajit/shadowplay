/**
 * The Book of Shadows: every finished tale, kept on this device. Tales the
 * Lantern told carry its signature, so on later nights it can be reminded of
 * them (and nobody can slip it a tale it never told). The book also keeps
 * the theatre's nights (the moon grows with each one), the keepsakes the
 * tales left behind, and the Lantern's promise for the next night.
 */

import { CREATURE_IDS, type CreatureId, type Keep, type Keepsake, KEEPSAKES, type SignedTale, TEASERS } from './protocol.js';

export interface Tale {
  title: string;
  summary: string;
  cast: CreatureId[];
  /** Epoch ms. */
  at: number;
  by: 'lantern' | 'understudy';
  sig?: string;
  /** The paper keepsake the tale left hanging in the theatre. */
  keepsake?: Keepsake;
  /** The promise for the next night ("Tomorrow, I'll tell you…"). */
  promise?: string;
  /** The understudy's plan for its promise: which of its tales, led by whom. */
  plan?: { quest: number; who: CreatureId };
}

const KEY = 'shadowplay.book.v1';
const MAX = 60;
/** Keepsakes on the garland at once (the newest). */
export const GARLAND_MAX = 12;

const isCreature = (c: unknown): c is CreatureId => (CREATURE_IDS as readonly unknown[]).includes(c);

export function loadBook(): Tale[] {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (t): t is Tale =>
          !!t && typeof t.title === 'string' && typeof t.summary === 'string' && typeof t.at === 'number' && Array.isArray(t.cast),
      )
      .map((t) => {
        const plan = t.plan && isCreature(t.plan.who) && Number.isInteger(t.plan.quest) && t.plan.quest >= 0 && t.plan.quest < TEASERS.length ? t.plan : undefined;
        return {
          ...t,
          cast: t.cast.filter(isCreature),
          keepsake: (KEEPSAKES as readonly unknown[]).includes(t.keepsake) ? t.keepsake : undefined,
          promise: typeof t.promise === 'string' ? t.promise : undefined,
          plan,
        };
      });
  } catch {
    return [];
  }
}

export function addTale(tale: Tale): void {
  try {
    const book = loadBook();
    book.push(tale);
    localStorage.setItem(KEY, JSON.stringify(book.slice(-MAX)));
  } catch {
    /* storage unavailable: the tale lives only tonight */
  }
}

/** The last few signed tales, oldest first, to remind the Lantern of earlier nights. */
export function recentSaga(book: Tale[], n = 3): SignedTale[] {
  return book
    .filter((t) => t.by === 'lantern' && typeof t.sig === 'string')
    .slice(-n)
    .map((t) => ({ title: t.title, summary: t.summary, ...(t.promise ? { promise: t.promise } : {}), sig: t.sig! }));
}

/** A theatre night runs from 5 am to 5 am, so a story told after midnight still belongs to its evening. */
export function nightKey(at: number): string {
  const d = new Date(at - 5 * 3_600_000);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Which night tonight is in this theatre: 1 on the first, and one more for every night with a tale since. */
export function nightNumber(book: Tale[], now = Date.now()): number {
  const nights = new Set(book.map((t) => nightKey(t.at)));
  nights.add(nightKey(now));
  return nights.size;
}

/** The promise made at the end of the last tale, if it is still to be kept tonight (never on the night it was made). */
export function pendingPromise(book: Tale[], now = Date.now()): { keep: Keep; text: string } | null {
  const last = book[book.length - 1];
  if (!last?.promise || nightKey(last.at) === nightKey(now)) return null;
  if (last.by === 'lantern' && last.sig) return { keep: 'last', text: last.promise };
  if (last.plan) return { keep: last.plan, text: last.promise };
  return null;
}

/** The keepsakes on the garland, oldest first. */
export function keepsakesOf(book: Tale[]): Keepsake[] {
  return book.flatMap((t) => (t.keepsake ? [t.keepsake] : [])).slice(-GARLAND_MAX);
}
