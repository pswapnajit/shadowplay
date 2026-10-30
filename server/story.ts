/**
 * The story endpoint: POST a StoryRequest, get the Lantern's next beat back
 * as newline-delimited JSON events, one script step at a time.
 *
 * Stateless by design. The client keeps the conversation, and every earlier
 * beat it sends back must carry the server's HMAC signature, so a client can
 * replay the Lantern's own words but never put words in its mouth. The
 * player's side is structured events only.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { waitUntil } from '@vercel/functions';
import { StepExtractor } from '../src/story/json-stream.js';
import {
  BEAT_SCHEMA,
  LIMITS,
  parseBeat,
  parseEvent,
  parseStep,
  renderEvent,
  type ServerEvent,
  type SignedTale,
  type SignedTurn,
  type Step,
  type StoryEvent,
} from '../src/story/protocol.js';
import { SYSTEM_PROMPT } from './prompt.js';

type Msg = Anthropic.Beta.BetaMessageParam;

const env = (k: string) => process.env[k]?.trim() || undefined;

const DEFAULT_ORIGINS = ['https://pswapnajit.github.io'];
export function originAllowed(origin: string | null, host: string | null = null): boolean {
  if (!origin) return false;
  // The game served from this same deployment, whatever its domain.
  if (host && /^https:\/\//.test(origin) && new URL(origin).host === host) return true;
  const extra = (env('STORY_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (DEFAULT_ORIGINS.includes(origin) || extra.includes(origin)) return true;
  // Local development (the IWSDK dev server) and this project's own Vercel deployments.
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return true;
  return /^https:\/\/shadowplay[a-z0-9-]*\.vercel\.app$/.test(origin);
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function cors(origin: string | null, host: string | null = null): Record<string, string> {
  return originAllowed(origin, host)
    ? {
        'Access-Control-Allow-Origin': origin!,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };
}

// --- signatures --------------------------------------------------------------
let cachedKey: Buffer | null = null;
function signingKey(): Buffer {
  if (cachedKey) return cachedKey;
  // STORY_SECRET if set; otherwise derived from the API key so no extra setup is needed.
  const seed = env('STORY_SECRET') ?? `shadowplay-story-v1:${env('ANTHROPIC_API_KEY') ?? 'dev'}`;
  cachedKey = createHash('sha256').update(seed).digest();
  return cachedKey;
}
const mac = (data: string) => createHmac('sha256', signingKey()).update(data).digest('base64url');
function sameMac(data: string, sig: unknown): boolean {
  if (typeof sig !== 'string' || sig.length > 100) return false;
  const a = Buffer.from(mac(data));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const signTurn = (content: unknown[]): SignedTurn => ({ content, sig: mac(`turn:${JSON.stringify(content)}`) });
const turnValid = (t: SignedTurn) => Array.isArray(t.content) && sameMac(`turn:${JSON.stringify(t.content)}`, t.sig);
/** A finished tale, with its promise for the next night: signed together, so the promise is the Lantern's own words. */
export const signTale = (title: string, summary: string, promise = ''): SignedTale => ({
  title,
  summary,
  ...(promise ? { promise } : {}),
  sig: mac(`tale:${title}\n${summary}\n${promise}`),
});
/** A line the Lantern spoke, signed as it was told: only signed lines (and the theatre's own phrases) get a voice. */
export const signLine = (text: string): string => mac(`say:${text}`);
export const lineValid = (text: string, sig: unknown): boolean => sameMac(`say:${text}`, sig);
const taleValid = (t: SignedTale) =>
  typeof t.title === 'string' &&
  typeof t.summary === 'string' &&
  (t.promise === undefined || typeof t.promise === 'string') &&
  sameMac(`tale:${t.title}\n${t.summary}\n${t.promise ?? ''}`, t.sig);

/** A step for the client; narration lines carry their signature (for the voice). */
function stepEvent(step: Step): ServerEvent {
  return { type: 'step', step, ...('say' in step ? { sig: signLine(step.say) } : {}) };
}

// --- rate limiting (best effort: per warm instance) -------------------------------
const windows = new Map<string, number[]>();
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    windows.set(key, hits);
    return false;
  }
  hits.push(now);
  windows.set(key, hits);
  if (windows.size > 5000) windows.clear();
  return true;
}
export function clientKey(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for') ?? '';
  return fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'anon';
}

// --- request validation ---------------------------------------------------------
export interface ValidRequest {
  events: StoryEvent[];
  turns: SignedTurn[];
  saga: SignedTale[];
}

export function validateRequest(body: unknown): ValidRequest | string {
  if (!body || typeof body !== 'object') return 'Expected a JSON object.';
  const b = body as Record<string, unknown>;
  if (b.v !== 1) return 'Unknown protocol version.';
  if (!Array.isArray(b.events) || !Array.isArray(b.turns)) return 'Missing events or turns.';
  if (b.turns.length >= LIMITS.maxTurns) return 'The story is already over.';
  if (b.events.length !== b.turns.length + 1) return 'Expected exactly one event per turn, plus the opening.';
  const events: StoryEvent[] = [];
  for (let i = 0; i < b.events.length; i++) {
    const e = parseEvent(b.events[i]);
    if (!e || (i === 0) !== (e.type === 'open')) return `Event ${i} is not valid here.`;
    events.push(e);
  }
  const turns = b.turns as SignedTurn[];
  if (!turns.every((t) => t && typeof t === 'object' && turnValid(t))) return 'A previous beat failed its signature check.';
  // Earlier tales that fail their signature are left out rather than refused: a stale or
  // edited Book of Shadows shouldn't cost the player tonight's story.
  const saga = Array.isArray(b.saga) ? (b.saga as SignedTale[]).slice(-LIMITS.sagaTales).filter((t) => t && typeof t === 'object' && taleValid(t)) : [];
  // Keeping "the last tale's promise" only makes sense if that tale came through.
  const open = events[0] as Extract<StoryEvent, { type: 'open' }>;
  if (open.keep === 'last' && !saga[saga.length - 1]?.promise) delete open.keep;
  return { events, turns, saga };
}

/** The conversation: rendered events from the player, the Lantern's signed beats in between. */
export function buildMessages(req: ValidRequest): Msg[] {
  const msgs: Msg[] = [];
  req.events.forEach((e, i) => {
    msgs.push({ role: 'user', content: renderEvent(e, i, i === 0 ? req.saga : []) });
    if (i < req.turns.length) msgs.push({ role: 'assistant', content: req.turns[i].content as Anthropic.Beta.BetaContentBlockParam[] });
  });
  return msgs;
}

// --- the handler -------------------------------------------------------------------
let client: Anthropic | null = null;

/** Minimal surface used here, so tests can pass a fake client. */
export interface StoryDeps {
  client?: Pick<Anthropic, 'beta'>;
}

export async function handleStory(request: Request, deps: StoryDeps = {}): Promise<Response> {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? hostOf(request.url);
  const headers = cors(origin, host);
  const json = (data: ServerEvent, status: number) =>
    new Response(`${JSON.stringify(data)}\n`, { status, headers: { ...headers, 'Content-Type': 'application/json' } });

  if (request.method === 'OPTIONS') return new Response(null, { status: originAllowed(origin, host) ? 204 : 403, headers });
  if (request.method !== 'POST') return json({ type: 'error', code: 'invalid', message: 'POST a story request.' }, 405);
  if (!originAllowed(origin, host)) return json({ type: 'error', code: 'invalid', message: 'Origin not allowed.' }, 403);

  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey || env('STORY_DISABLED') === '1') {
    return json({ type: 'error', code: 'off', message: 'The Lantern is resting tonight.' }, 503);
  }
  const ip = clientKey(request);
  const perHour = Number(env('STORY_RATE_PER_HOUR') ?? 90);
  if (!allow(`ip:${ip}`, perHour, 3_600_000) || !allow('all', Number(env('STORY_GLOBAL_PER_HOUR') ?? 1500), 3_600_000)) {
    return json({ type: 'error', code: 'rate', message: 'The Lantern needs a rest. Try again a little later.' }, 429);
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > LIMITS.bodyBytes) return json({ type: 'error', code: 'invalid', message: 'Request too large.' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ type: 'error', code: 'invalid', message: 'Invalid JSON.' }, 400);
  }
  const req = validateRequest(body);
  if (typeof req === 'string') return json({ type: 'error', code: 'invalid', message: req }, 400);

  const api = deps.client ?? (client ??= new Anthropic({ apiKey, maxRetries: 1, timeout: 40_000 }));
  // Haiku: quick (the first line is on the wall in about two seconds) and inexpensive enough to leave open to everyone.
  const model = env('STORY_MODEL') ?? 'claude-haiku-5-5';
  const effort = (env('STORY_EFFORT') ?? 'low') as 'low' | 'medium' | 'high';
  const encoder = new TextEncoder();
  let closed = false;
  let abort: (() => void) | null = null;

  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
    cancel() {
      // The player left: stop generating (and paying for) a beat nobody will see.
      closed = true;
      abort?.();
    },
  });
  const emit = (e: ServerEvent) => {
    if (closed || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
    } catch {
      closed = true;
    }
  };

  const work = (async () => {
    const t0 = Date.now();
    try {
      const s = api.beta.messages.stream({
        model,
        max_tokens: 4000,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: buildMessages(req),
        output_config: { effort, format: { type: 'json_schema', schema: BEAT_SCHEMA } },
        // Automatic caching for the growing conversation; the system prompt has its own breakpoint.
        cache_control: { type: 'ephemeral' },
        // Server-side refusal fallback: a declined request is re-run on Anthropic's recommended model.
        ...(/haiku/i.test(model) ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
      });
      abort = () => s.abort();
      const steps = new StepExtractor();
      let sent = 0;
      s.on('text', (delta) => {
        for (const raw of steps.push(delta)) {
          const step = parseStep(raw);
          if (step) {
            emit(stepEvent(step));
            sent++;
          }
        }
      });
      const msg = await s.finalMessage();
      const u = msg.usage;
      console.log(
        `[story] turn ${req.turns.length} ${msg.model} ${msg.stop_reason} in ${Date.now() - t0} ms; ` +
          `in ${u.input_tokens} (+${u.cache_read_input_tokens ?? 0} cached, +${u.cache_creation_input_tokens ?? 0} written), out ${u.output_tokens}`,
      );
      if (msg.stop_reason === 'refusal') {
        emit({ type: 'error', code: 'refusal', message: 'The Lantern lost the thread.' });
        return;
      }
      if (msg.stop_reason === 'max_tokens') {
        emit({ type: 'error', code: 'cut', message: 'The Lantern ran out of breath.' });
        return;
      }
      // After a mid-answer fallback the answer is the text that follows the last switch point.
      const blocks = msg.content as { type: string; text?: string }[];
      const from = blocks.map((b) => b.type).lastIndexOf('fallback') + 1;
      const text = blocks.slice(from).map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('');
      let beat = null;
      try {
        beat = parseBeat(JSON.parse(text));
      } catch {
        /* handled below */
      }
      if (!beat) {
        emit({ type: 'error', code: 'unavailable', message: 'The Lantern mumbled.' });
        return;
      }
      // Anything the incremental scan missed (it shouldn't) goes out now, in order.
      for (const step of beat.script.slice(sent)) emit(stepEvent(step));
      // The ending's promise is spoken too, so it is signed like a line.
      emit({ type: 'next', next: beat.next, ...('end' in beat.next && beat.next.tomorrow ? { sig: signLine(beat.next.tomorrow) } : {}) });
      const turn = signTurn(msg.content as unknown[]);
      const tale = 'end' in beat.next ? signTale(beat.next.end, beat.next.summary, beat.next.tomorrow) : undefined;
      emit({ type: 'turn', turn, ...(tale ? { tale } : {}) });
      emit({ type: 'done', ms: Date.now() - t0, model: msg.model });
    } catch (error) {
      if (closed) return;
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      console.error(`[story] failed after ${Date.now() - t0} ms`, status ?? '', (error as Error).message);
      const code = error instanceof Anthropic.RateLimitError ? 'rate' : 'unavailable';
      emit({ type: 'error', code, message: 'The Lantern flickered.' });
    } finally {
      if (!closed) {
        closed = true;
        try {
          controllerRef?.close();
        } catch {
          /* already closed */
        }
      }
    }
  })();
  // The response returns before the beat is written; on Vercel, waitUntil keeps
  // the instance running until it is.
  if (process.env.VERCEL) waitUntil(work);

  return new Response(stream, {
    status: 200,
    headers: {
      ...headers,
      // An event stream (one JSON object per line) so proxies don't buffer or compress it.
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
