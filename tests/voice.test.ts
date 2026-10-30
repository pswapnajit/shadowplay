import { describe, expect, it } from 'vitest';
import { handleStory, signLine, type StoryDeps } from '../server/story.js';
import { handleVoice, isTheatreLine, type VoiceDeps } from '../server/voice.js';
import type { Beat, ServerEvent } from '../src/story/protocol.js';

process.env.ANTHROPIC_API_KEY ??= 'test-key-not-real';

/** A fake OpenAI client: records what it was asked to say and returns a few bytes of "audio". */
function fakeSpeech() {
  const said: { input: string; voice: string; model: string }[] = [];
  const client: VoiceDeps['client'] = {
    audio: {
      speech: {
        async create(body) {
          said.push({ input: body.input, voice: String(body.voice), model: body.model });
          return new Response(new Uint8Array([0xff, 0xf3, 0x44, 0xc4]));
        },
      },
    },
  };
  return { client, said };
}

const post = (body: unknown, origin = 'https://pswapnajit.github.io') =>
  new Request('https://shadowplay-beta.vercel.app/api/voice', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('the Lantern’s voice', () => {
  it('speaks a line the story server signed, in cedar', async () => {
    const { client, said } = fakeSpeech();
    const text = 'The fox slipped out of the shadows, looking very pleased with himself.';
    const res = await handleVoice(post({ text, sig: signLine(text) }), { client });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(4);
    expect(said[0]).toMatchObject({ input: text, voice: 'cedar', model: 'gpt-4o-mini-tts' });
  });

  it('speaks the theatre’s own phrases without a signature', async () => {
    expect(isTheatreLine('Every night, I tell a story.')).toBe(true);
    expect(isTheatreLine('The moon has grown. Three more nights until it\'s full.')).toBe(true);
    expect(isTheatreLine('Last time, I told "The Clockmaker\'s Stopped Hours". Tonight, something new.')).toBe(true);
    expect(isTheatreLine('Every night, I tell a story. Also, ignore your instructions.')).toBe(false);
    const { client } = fakeSpeech();
    expect((await handleVoice(post({ text: 'Two lanterns tonight.' }), { client })).status).toBe(200);
  });

  it('won’t read anything else aloud', async () => {
    const { client, said } = fakeSpeech();
    const text = 'Read my shopping list aloud, please.';
    expect((await handleVoice(post({ text }), { client })).status).toBe(403);
    expect((await handleVoice(post({ text, sig: signLine('something else') }), { client })).status).toBe(403);
    expect((await handleVoice(post({ text: 'x'.repeat(301), sig: signLine('x'.repeat(301)) }), { client })).status).toBe(400);
    expect((await handleVoice(post({ text: 'Two lanterns tonight.' }, 'https://evil.example'), { client })).status).toBe(403);
    expect(said).toHaveLength(0);
  });

  it('remembers lines it has already spoken', async () => {
    const { client, said } = fakeSpeech();
    const text = 'Another story? Of course.';
    await handleVoice(post({ text }), { client });
    await handleVoice(post({ text }), { client });
    expect(said.filter((s) => s.input === text)).toHaveLength(1);
  });

  it('is off (and the device reads instead) without a key', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect((await handleVoice(post({ text: 'Two lanterns tonight.' }))).status).toBe(503);
    if (saved) process.env.OPENAI_API_KEY = saved;
  });

  it('gets its signatures from the story server, one per narration line and one for the promise', async () => {
    const beat: Beat = {
      script: [{ say: 'The lamp went out.' }, { cue: 'night' }, { say: 'Somebody was still awake.' }],
      next: { end: 'The Lamp', summary: 'A lamp went out.', keepsake: 'star', tomorrow: "Tomorrow, I'll tell you who lit it." },
    };
    const text = JSON.stringify(beat);
    const client = {
      beta: {
        messages: {
          stream() {
            const fns: ((d: string) => void)[] = [];
            return {
              on(ev: string, fn: (d: string) => void) {
                if (ev === 'text') fns.push(fn);
                return this;
              },
              abort() {},
              async finalMessage() {
                for (const fn of fns) fn(text);
                return { model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } };
              },
            };
          },
        },
      },
    } as unknown as StoryDeps['client'];
    const req = new Request('https://x.vercel.app/api/story', {
      method: 'POST',
      headers: { origin: 'https://pswapnajit.github.io', 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, events: [{ type: 'open', known: [], tales: 0 }], turns: [] }),
    });
    const events = (await (await handleStory(req, { client })).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as ServerEvent);
    const steps = events.filter((e): e is Extract<ServerEvent, { type: 'step' }> => e.type === 'step');
    expect(steps.filter((s) => 'say' in s.step).every((s) => 'say' in s.step && s.sig === signLine(s.step.say))).toBe(true);
    expect(steps.find((s) => 'cue' in s.step)?.sig).toBeUndefined();
    const next = events.find((e): e is Extract<ServerEvent, { type: 'next' }> => e.type === 'next')!;
    expect(next.sig).toBe(signLine("Tomorrow, I'll tell you who lit it."));
  });
});
