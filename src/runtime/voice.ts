/**
 * The Lantern's speaking voice. Lines the Lantern tells are spoken in its own
 * storytelling voice (OpenAI text to speech, through the story server's
 * /api/voice), fetched ahead while earlier lines are still being read, and
 * played from the lantern itself so it murmurs over the player's shoulder.
 * Without the voice server (offline, no key, a failure) the device's own
 * speech synthesis reads instead, and without either the Lantern keeps its
 * wordless murmur.
 */

import { audio } from './audio.js';

/** Warm, unhurried storytelling voices for the device's own synthesis, best first (whatever the device has). */
const PREFERRED = [
  /^Daniel/i,
  /Google UK English Male/i,
  /Google UK English Female/i,
  /Natural.*\(English \(United Kingdom\)\)/i,
  /^Serena/i,
  /^Moira/i,
  /^Samantha/i,
  /^Karen/i,
  /Natural.*English/i,
  /Google US English/i,
];

const KEY = 'shadowplay.voice';
/** A line whose audio hasn't arrived by now is read by the device's voice instead. */
const WAIT_MS = 5000;

export interface SpeakOptions {
  /** The story server's signature for the line (lines without one use the device's voice, unless they're the theatre's own phrases). */
  sig?: string;
  /** The line is one of the theatre's fixed phrases, which the voice server speaks without a signature. */
  theatre?: boolean;
  /** Character index of each word as it's spoken. */
  onWord?: (charIndex: number) => void;
  /** The voice has started (the words on the wall wait for it). */
  onStart?: () => void;
}

export class LanternVoice {
  private readonly synth: SpeechSynthesis | null = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  private voice: SpeechSynthesisVoice | null = null;
  /** The player's choice (remembered); speaking also needs a voice to exist. */
  wanted = true;
  /** True while a line is being spoken (or fetched to be spoken). */
  speaking = false;
  /** `?voice=silent`: keep the voice's timing but make no sound. */
  private silent = false;
  /** `?voice=device`: always use the device's own voice. */
  private deviceOnly = false;
  private server: string | null = null;
  /** The voice server is unreachable or switched off: the device reads for the rest of the visit. */
  private serverDown = false;
  private readonly lines = new Map<string, Promise<AudioBuffer | null>>();
  private source: AudioBufferSourceNode | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private token = 0;

  constructor() {
    try {
      this.wanted = localStorage.getItem(KEY) !== 'off';
    } catch {
      /* default on */
    }
    const param = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('voice') : null;
    if (param === 'off') this.wanted = false;
    this.silent = param === 'silent';
    this.deviceOnly = param === 'device';
    if (!this.synth) return;
    const pick = () => {
      const voices = this.synth!.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
      for (const re of PREFERRED) {
        const v = voices.find((x) => re.test(x.name));
        if (v) {
          this.voice = v;
          return;
        }
      }
      this.voice = voices.find((v) => v.localService) ?? voices[0] ?? null;
    };
    pick();
    this.synth.addEventListener?.('voiceschanged', pick);
  }

  /** Where the Lantern's own voice is synthesised (beside the story server), or null for the device's voice only. */
  useServer(url: string | null): void {
    this.server = url;
  }

  /** The Lantern's own (neural) voice is in use. */
  get neural(): boolean {
    return !!this.server && !this.serverDown && !this.deviceOnly;
  }

  get available(): boolean {
    return this.neural || !!this.voice;
  }

  get on(): boolean {
    return this.wanted && this.available;
  }

  set(on: boolean): void {
    this.wanted = on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* not remembered */
    }
    if (!on) this.cancel();
  }

  get voiceName(): string {
    return this.neural ? 'the Lantern' : this.voice?.name ?? '';
  }

  /** Starts fetching a line's audio ahead of time (while earlier lines are still being read). */
  prepare(text: string, opts: Pick<SpeakOptions, 'sig' | 'theatre'> = {}): void {
    if (this.on && this.neural && (opts.sig || opts.theatre)) void this.fetchLine(text, opts.sig);
  }

  private fetchLine(text: string, sig?: string): Promise<AudioBuffer | null> {
    let p = this.lines.get(text);
    if (p) return p;
    p = (async () => {
      const res = await fetch(this.server!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, ...(sig ? { sig } : {}) }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        // switched off, or no key: don't keep asking
        if (res.status === 503) this.serverDown = true;
        return null;
      }
      const bytes = await res.arrayBuffer();
      audio.start();
      return audio.ctx ? await audio.ctx.decodeAudioData(bytes) : null;
    })().catch(() => null);
    this.lines.set(text, p);
    if (this.lines.size > 48) this.lines.delete(this.lines.keys().next().value!);
    return p;
  }

  /** Speaks a line: in the Lantern's own voice if it can, else the device's. */
  speak(text: string, opts: SpeakOptions = {}): void {
    if (!this.on) return;
    this.cancel();
    const token = this.token;
    if (this.neural && (opts.sig || opts.theatre)) {
      this.speaking = true;
      const asked = performance.now();
      void this.fetchLine(text, opts.sig).then((buf) => {
        if (token !== this.token) return; // cancelled, or the next line began
        if (buf && performance.now() - asked < WAIT_MS && this.play(buf, text, opts, token)) return;
        this.speaking = false;
        this.deviceSpeak(text, opts);
      });
      return;
    }
    this.deviceSpeak(text, opts);
  }

  /** Plays a fetched line from the lantern, and shows each word as it's (about to be) spoken. */
  private play(buf: AudioBuffer, text: string, opts: SpeakOptions, token: number): boolean {
    const src = audio.playVoice(buf, this.silent ? 0 : 1);
    if (!src) return false;
    this.source = src;
    opts.onStart?.();
    // The audio has no word timings: spread the words over it by length, with a beat at each pause.
    const words = [...text.matchAll(/\S+/g)];
    const weight = (w: string) => w.length + 2 + (/[.!?…]["”’)]?$/.test(w) ? 7 : /[,;:—–]["”’)]?$/.test(w) ? 4 : 0);
    const total = words.reduce((a, m) => a + weight(m[0]), 0) || 1;
    const span = Math.max(0.3, buf.duration - 0.35);
    let acc = 0;
    for (const m of words) {
      const at = 0.08 + (acc / total) * span;
      this.timers.push(setTimeout(() => token === this.token && opts.onWord?.(m.index ?? 0), at * 1000));
      acc += weight(m[0]);
    }
    src.addEventListener('ended', () => {
      if (token !== this.token) return;
      this.speaking = false;
      this.source = null;
    });
    this.speaking = true;
    return true;
  }

  private deviceSpeak(text: string, opts: SpeakOptions): void {
    if (!this.synth || !this.voice || !this.wanted) {
      // nothing can read it: the words go on by themselves
      this.speaking = false;
      opts.onStart?.();
      return;
    }
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = this.voice;
    u.lang = this.voice.lang;
    u.rate = 0.92;
    u.pitch = 1;
    u.volume = this.silent ? 0 : 1;
    u.onstart = () => opts.onStart?.();
    u.onboundary = (e) => {
      if (e.name === 'word' || e.name === undefined) opts.onWord?.(e.charIndex);
    };
    u.onend = u.onerror = () => {
      this.speaking = false;
    };
    this.speaking = true;
    this.synth.speak(u);
  }

  cancel(): void {
    this.token++;
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
    try {
      this.source?.stop();
    } catch {
      /* already over */
    }
    this.source = null;
    this.synth?.cancel();
    this.speaking = false;
  }
}

export const voice = new LanternVoice();
