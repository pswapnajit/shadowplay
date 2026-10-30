import { describe, expect, it } from 'vitest';
import { fingerShape, straightness, straightnessFits } from '../src/core/fingers.js';
import { SEG_STRIDE } from '../src/core/shadow-geom.js';
import { specJoints } from '../src/core/targets.js';
import { CREATURE_BY_ID } from '../src/core/creatures.js';
import { newCode, normaliseCode, openLink, type Payload } from '../src/net/link.js';
import { decodeGuestFrame, decodeHostFrame, encodeGuestFrame, encodeHostFrame, STAGE_FLOATS } from '../src/net/wire.js';
import { OfflineTeller } from '../src/story/offline.js';
import { parseEvent, renderEvent, type StoryEvent } from '../src/story/protocol.js';

function segs(n: number, seed = 1): Float32Array {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = new Float32Array(n * SEG_STRIDE);
  for (let i = 0; i < n; i++) {
    const o = i * SEG_STRIDE;
    out[o] = rnd() * 2.4 - 1.2;
    out[o + 1] = rnd() * 2.4 - 1.2;
    out[o + 2] = rnd() * 0.08;
    out[o + 4] = rnd() * 2.4 - 1.2;
    out[o + 5] = rnd() * 2.4 - 1.2;
    out[o + 6] = rnd() * 0.08;
  }
  return out;
}

const close = (a: ArrayLike<number>, b: ArrayLike<number>, n: number, tol: number) => {
  for (let i = 0; i < n; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(tol);
};

describe('the wire', () => {
  it('carries the host’s stage, creatures and hands to an eighth of a millimetre', () => {
    const stage = Float32Array.from({ length: STAGE_FLOATS }, (_, i) => i * 0.1 - 1);
    const creatures = segs(120, 3);
    const alphas = Float32Array.from({ length: 120 }, (_, i) => (i % 10) / 9);
    const hands = segs(92, 7);
    const buf = encodeHostFrame(stage, creatures, alphas, 120, hands, 92);
    expect(buf.byteLength).toBeLessThan(5000);
    const out = { stage: new Float32Array(STAGE_FLOATS), creatures: new Float32Array(768 * SEG_STRIDE), alphas: new Float32Array(768), creatureCount: 0, hands: new Float32Array(92 * SEG_STRIDE), handCount: 0 };
    expect(decodeHostFrame(buf, out)).toBe(true);
    expect(out.creatureCount).toBe(120);
    expect(out.handCount).toBe(92);
    close(out.stage, stage, STAGE_FLOATS, 1e-6);
    close(out.creatures, creatures, 120 * SEG_STRIDE, 1 / 8000);
    close(out.alphas, alphas, 120, 1 / 255);
    close(out.hands, hands, 92 * SEG_STRIDE, 1 / 8000);
  });

  it('carries the guest’s hands, which are tracked, and how straight their fingers are', () => {
    const hands = segs(46, 9);
    const straight = Float32Array.from([1, 0.98, 0.55, 0.5, 0, 0, 0, 0]);
    const buf = encodeGuestFrame(hands, 46, 0b01, straight);
    const out = { hands: new Float32Array(92 * SEG_STRIDE), handCount: 0, tracked: 0, straight: new Float32Array(8) };
    expect(decodeGuestFrame(buf, out)).toBe(true);
    expect(out).toMatchObject({ handCount: 46, tracked: 1 });
    close(out.straight, straight, 8, 1e-6);
    close(out.hands, hands, 46 * SEG_STRIDE, 1 / 8000);
  });

  it('refuses frames that are too short or of the other kind', () => {
    const guest = encodeGuestFrame(segs(4), 4, 3, new Float32Array(8));
    const out = { stage: new Float32Array(STAGE_FLOATS), creatures: new Float32Array(8), alphas: new Float32Array(1), creatureCount: 0, hands: new Float32Array(8), handCount: 0 };
    expect(decodeHostFrame(guest, out)).toBe(false);
    expect(decodeGuestFrame(guest.slice(0, 20), { hands: new Float32Array(8), handCount: 0, tracked: 0, straight: new Float32Array(8) })).toBe(false);
  });

  it('never writes more segments than the receiver has room for', () => {
    const buf = encodeHostFrame(new Float32Array(STAGE_FLOATS), segs(50), new Float32Array(50), 50, segs(10), 10);
    const out = { stage: new Float32Array(STAGE_FLOATS), creatures: new Float32Array(20 * SEG_STRIDE), alphas: new Float32Array(20), creatureCount: 0, hands: new Float32Array(4 * SEG_STRIDE), handCount: 0 };
    expect(decodeHostFrame(buf, out)).toBe(true);
    expect(out.creatureCount).toBe(20);
    expect(out.handCount).toBe(4);
  });
});

describe('room codes', () => {
  it('are four unambiguous letters, however they are typed', () => {
    for (let i = 0; i < 50; i++) expect(normaliseCode(newCode())).not.toBeNull();
    expect(normaliseCode(' bcdf ')).toBe('BCDF');
    expect(normaliseCode('FOXY')).toBeNull(); // no vowels or Y: no accidental words
    expect(normaliseCode('BCD')).toBeNull();
    expect(normaliseCode(null)).toBeNull();
  });
});

describe('the link between two tabs', () => {
  it('opens when the guest knocks, and carries shadows and words both ways', async () => {
    const code = newCode();
    const host = await openLink('host', code, 'local');
    const got: Payload[] = [];
    const opened = new Promise<void>((r) => (host.onOpen = r));
    host.onMessage = (d) => got.push(d);
    const guest = await openLink('guest', code, 'local');
    const heard: Payload[] = [];
    guest.onMessage = (d) => heard.push(d);
    const guestIn = new Promise<void>((r) => (guest.onOpen = r));
    await Promise.all([opened, guestIn]);
    expect(host.connected && guest.connected).toBe(true);
    guest.send(encodeGuestFrame(segs(2), 2, 1, new Float32Array(8)));
    host.send('{"t":"hello","v":1}');
    await new Promise((r) => setTimeout(r, 50));
    expect(got[0]).toBeInstanceOf(ArrayBuffer);
    expect(heard).toEqual(['{"t":"hello","v":1}']);
    const closed = new Promise<void>((r) => (host.onClose = r));
    guest.close();
    await closed;
    expect(host.connected).toBe(false);
    host.close();
  });
});

describe('a friend’s fingers', () => {
  it('are checked from the straightness they send, like the player’s own joints', () => {
    const rabbit = fingerShape(specJoints(CREATURE_BY_ID.rabbit.hands[0]));
    const s = straightness(specJoints(CREATURE_BY_ID.rabbit.hands[0]));
    expect(straightnessFits(rabbit, s)).toBe(true);
    // an open hand: every finger straight
    expect(straightnessFits(rabbit, [1, 1, 1, 1])).toBe(false);
    expect(straightnessFits(rabbit, Float32Array.from([0, 0, 0, 0, ...s]), 4)).toBe(true);
  });
});

describe('the story with two players', () => {
  it('tells the Lantern a friend is casting, and who made what', () => {
    const open = parseEvent({ type: 'open', known: ['bird'], tales: 0, players: 2 });
    expect(open).toMatchObject({ players: 2 });
    expect(renderEvent(open!, 0)).toContain('Two players are casting tonight');
    const made = parseEvent({ type: 'made', asked: 'any', made: 'fox', seconds: 4, helped: false, calls: 0, first: true, friend: true });
    expect(made).toMatchObject({ friend: true });
    expect(renderEvent(made!, 1)).toContain('The friend far away made');
    expect(parseEvent({ type: 'open', known: [], tales: 0, players: 7 })).not.toHaveProperty('players');
  });

  it('lets the understudy welcome the friend’s creatures too', () => {
    const events: StoryEvent[] = [
      { type: 'open', known: ['bird'], tales: 0, players: 2 },
      { type: 'made', asked: 'any', made: 'fox', seconds: 4, helped: false, calls: 0, first: true, friend: true },
    ];
    const beat = new OfflineTeller(3).takeOver(events);
    expect(JSON.stringify(beat.script)).toContain('From the far side of the wall');
  });
});
