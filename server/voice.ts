/**
 * The Lantern's voice: POST a line of the story, get it back spoken (MP3),
 * by OpenAI's text to speech in the Lantern's own storytelling voice.
 *
 * Only the Lantern's own words are spoken: lines the story server signed as
 * it told them, and the theatre's few fixed phrases (its greetings, the
 * moon's news, the promise it is about to keep). So the endpoint can't be
 * used as a general text-to-speech service. Without a key, or when it fails,
 * the game reads the story with the device's own voice instead.
 */

import OpenAI from 'openai';
import { allow, clientKey, cors, hostOf, lineValid, originAllowed } from './story.js';

const env = (k: string) => process.env[k]?.trim() || undefined;

/** How the Lantern sounds. */
export const VOICE_INSTRUCTIONS =
  'You are the Lantern, a small paper lantern who tells bedtime stories in a shadow theatre. ' +
  'Speak like a warm, gentle storyteller reading by lamplight: unhurried, cosy and a little playful, with a sense of wonder. ' +
  'Leave small pauses at commas and full stops. Keep it soft and intimate; never shout.';

/** The theatre's own phrases, spoken before the story server has said anything (see story-mode.ts). */
const THEATRE_LINES: RegExp[] = [
  /^Every (morning|afternoon|evening|night), I tell a story\.$/,
  /^(Tonight|Today), you cast it\. Whoever you make on the wall will be in it\.$/,
  /^Another story\? Of course\.$/,
  /^Let's see who comes out of the dark\.$/,
  /^The moon is full tonight\.$/,
  /^On full-moon nights, old friends come back\.$/,
  /^The moon has grown\. (One|Two|Three|Four|Five|Six|Seven) more nights? until it's full\.$/,
  /^Last time, I made you a promise\. Tonight, I keep it\.$/,
  /^Last time, I told "[A-Za-z0-9 ',.!?:;-]{1,60}"\. (Tonight|Today), something new\.$/,
  /^Two lanterns tonight\.$/,
  /^One of you is far away, but your shadows share this wall\.$/,
];

export function isTheatreLine(text: string): boolean {
  return THEATRE_LINES.some((re) => re.test(text));
}

/** Recently spoken lines (the theatre's greetings come round again and again). */
const cache = new Map<string, Uint8Array>();
const CACHE_MAX = 64;

let client: OpenAI | null = null;

/** Minimal surface used here, so tests can pass a fake client. */
export interface VoiceDeps {
  client?: { audio: { speech: { create(body: OpenAI.Audio.SpeechCreateParams): PromiseLike<Response> } } };
}

export async function handleVoice(request: Request, deps: VoiceDeps = {}): Promise<Response> {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? hostOf(request.url);
  const headers = cors(origin, host);
  const fail = (status: number, code: string, message: string) =>
    new Response(JSON.stringify({ type: 'error', code, message }), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

  if (request.method === 'OPTIONS') return new Response(null, { status: originAllowed(origin, host) ? 204 : 403, headers });
  if (request.method !== 'POST') return fail(405, 'invalid', 'POST a line.');
  if (!originAllowed(origin, host)) return fail(403, 'invalid', 'Origin not allowed.');
  const apiKey = env('OPENAI_API_KEY');
  if ((!apiKey && !deps.client) || env('VOICE_DISABLED') === '1') return fail(503, 'off', 'The Lantern is reading quietly tonight.');

  let body: { text?: unknown; sig?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 2000) return fail(413, 'invalid', 'Too long.');
    body = JSON.parse(raw) as typeof body;
  } catch {
    return fail(400, 'invalid', 'Invalid JSON.');
  }
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text || text.length > 300) return fail(400, 'invalid', 'Expected a line of the story.');
  if (!lineValid(text, body.sig) && !isTheatreLine(text)) return fail(403, 'invalid', 'Only the Lantern’s own lines can be spoken.');

  const audioHeaders = { ...headers, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=86400' };
  const hit = cache.get(text);
  if (hit) return new Response(hit.slice(), { status: 200, headers: audioHeaders });

  const ip = clientKey(request);
  if (!allow(`voice:${ip}`, Number(env('VOICE_RATE_PER_HOUR') ?? 400), 3_600_000) || !allow('voice:all', Number(env('VOICE_GLOBAL_PER_HOUR') ?? 8000), 3_600_000)) {
    return fail(429, 'rate', 'The Lantern needs to rest its voice.');
  }

  const api = deps.client ?? (client ??= new OpenAI({ apiKey, maxRetries: 1, timeout: 20_000 }));
  try {
    const t0 = Date.now();
    const speech = await api.audio.speech.create({
      model: env('VOICE_MODEL') ?? 'gpt-4o-mini-tts',
      voice: env('VOICE_NAME') ?? 'cedar',
      input: text,
      instructions: VOICE_INSTRUCTIONS,
      response_format: 'mp3',
    });
    const bytes = new Uint8Array(await speech.arrayBuffer());
    console.log(`[voice] ${text.length} chars in ${Date.now() - t0} ms, ${bytes.length} bytes`);
    cache.set(text, bytes);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return new Response(bytes.slice(), { status: 200, headers: audioHeaders });
  } catch (error) {
    console.error('[voice] failed', (error as { status?: number }).status ?? '', (error as Error).message);
    return fail(502, 'unavailable', 'The Lantern lost its voice.');
  }
}
