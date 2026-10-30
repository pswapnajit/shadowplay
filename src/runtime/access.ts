/**
 * Comfort and access: options chosen on the landing page and remembered on
 * this device. Shadowplay is hands-first and needs none of them; they widen
 * who can play. `?look`, `?onehand`, `?gentle`, `?calm`, `?bigtext` and
 * `?contrast` turn one on for a single visit (a shared link, or a test).
 */

import { state } from './state.js';

export const ACCESS_OPTIONS = [
  { key: 'look', param: 'look', label: 'Look to choose', detail: 'Play hands-free: look at a creature or an outline to call it.' },
  { key: 'oneHand', param: 'onehand', label: 'One hand', detail: 'Lessons and stories only use creatures made with one hand.' },
  { key: 'gentle', param: 'gentle', label: 'Gentle shapes', detail: 'Creatures wake from a looser shadow, and the ghost hand helps sooner.' },
  { key: 'calm', param: 'calm', label: 'Calm stage', detail: 'No lightning flashes and no swaying lantern.' },
  { key: 'bigText', param: 'bigtext', label: 'Bigger words', detail: 'Larger story text on the wall.' },
  { key: 'highContrast', param: 'contrast', label: 'High contrast', detail: 'Darker, crisper shadows in a brighter light.' },
] as const;

export type AccessKey = (typeof ACCESS_OPTIONS)[number]['key'];

const KEY = 'shadowplay.access.v1';

/** Reads the remembered options (and any URL overrides) into the settings. */
export function loadAccess(): void {
  let saved: Partial<Record<AccessKey, unknown>> = {};
  try {
    saved = (JSON.parse(localStorage.getItem(KEY) ?? '{}') as typeof saved) ?? {};
  } catch {
    /* defaults */
  }
  const params = new URLSearchParams(location.search);
  for (const o of ACCESS_OPTIONS) state.settings[o.key] = saved[o.key] === true || params.has(o.param);
  apply();
}

export function setAccess(key: AccessKey, on: boolean): void {
  state.settings[key] = on;
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(ACCESS_OPTIONS.map((o) => [o.key, state.settings[o.key]]))));
  } catch {
    /* this visit only */
  }
  apply();
}

function apply(): void {
  state.settings.tolerance = state.settings.gentle ? 'easy' : 'normal';
}
