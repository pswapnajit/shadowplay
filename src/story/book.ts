/**
 * The Book of Shadows: every finished tale, kept on this device. Tales the
 * Lantern told carry its signature, so on later nights it can be reminded of
 * them (and nobody can slip it a tale it never told).
 */

import { CREATURE_IDS, type CreatureId, type SignedTale } from './protocol.js';

export interface Tale {
  title: string;
  summary: string;
  cast: CreatureId[];
  /** Epoch ms. */
  at: number;
  by: 'lantern' | 'understudy';
  sig?: string;
}

const KEY = 'shadowplay.book.v1';
const MAX = 60;

export function loadBook(): Tale[] {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(data)) return [];
    return data.filter(
      (t): t is Tale =>
        !!t && typeof t.title === 'string' && typeof t.summary === 'string' && typeof t.at === 'number' && Array.isArray(t.cast),
    ).map((t) => ({ ...t, cast: t.cast.filter((c) => (CREATURE_IDS as readonly string[]).includes(c)) }));
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
    .map((t) => ({ title: t.title, summary: t.summary, sig: t.sig! }));
}
