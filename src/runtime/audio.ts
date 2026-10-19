/**
 * Procedural sound: everything is synthesised with Web Audio, so there are
 * no assets to license and nothing to download.
 */

const PENT = [0, 2, 4, 7, 9];

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private plucks = new Map<number, AudioBuffer>();
  muted = false;

  /** Must be called from a user gesture (Enter XR click, first pinch…). */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    this.master = master;
    this.startAmbience();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  /** Warm room tone and a soft candle crackle. */
  private startAmbience(): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master!);
    this.ambience = g;
    // drone: two detuned sines an octave apart
    for (const [f, a] of [
      [98, 0.05],
      [147.3, 0.025],
      [196.4, 0.012],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = a;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07 + f * 0.0003;
      const lg = ctx.createGain();
      lg.gain.value = a * 0.5;
      lfo.connect(lg).connect(og.gain);
      o.connect(og).connect(g);
      o.start();
      lfo.start();
    }
    // crackle: sparse filtered clicks
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.9 : (Math.random() * 2 - 1) * 0.004;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.7;
    const cg = ctx.createGain();
    cg.gain.value = 0.35;
    src.connect(bp).connect(cg).connect(g);
    src.start();
  }

  /** Fade the ambience in or out (0..1). */
  setAmbience(level: number): void {
    if (this.ambience && this.ctx) this.ambience.gain.setTargetAtTime(level, this.ctx.currentTime, 1.2);
  }

  static degreeToFreq(deg: number, base = 392): number {
    const oct = Math.floor(deg / 5);
    const semi = PENT[((deg % 5) + 5) % 5] + 12 * oct;
    return base * Math.pow(2, semi / 12);
  }

  /** Karplus–Strong plucked string, cached per frequency. */
  private pluckBuffer(freq: number): AudioBuffer {
    const key = Math.round(freq * 10);
    const cached = this.plucks.get(key);
    if (cached) return cached;
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 1.6);
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const period = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0;
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const cur = ring[idx];
      const next = 0.5 * (cur + prev) * 0.996;
      prev = cur;
      ring[idx] = next;
      out[i] = cur * 0.5;
      idx = (idx + 1) % period;
    }
    this.plucks.set(key, buf);
    return buf;
  }

  pluck(freq: number, when = 0, gain = 0.5, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const src = ctx.createBufferSource();
    src.buffer = this.pluckBuffer(freq);
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p).connect(this.master!);
    src.start(ctx.currentTime + when);
  }

  /** A creature's little song, on a plucked string. */
  song(degrees: number[], tempo = 0.16, pan = 0): void {
    degrees.forEach((d, i) => this.pluck(AudioEngine.degreeToFreq(d), i * tempo, 0.4, pan));
  }

  /** Bell-like shimmer when a shadow wakes up. */
  awaken(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime;
    [523.3, 784, 1046.5, 1568].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + i * 0.07);
      g.gain.linearRampToValueAtTime(0.16 / (i + 1), t0 + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.07 + 2.2);
      o.connect(g).connect(this.master!);
      o.start(t0 + i * 0.07);
      o.stop(t0 + 2.5);
    });
    // breathy whoosh
    this.noiseSweep(400, 3000, 0.9, 0.12);
  }

  /** A warm swell as the lantern settles and the wall lights up. */
  lanternLit(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime;
    for (const [f, a] of [
      [196, 0.14],
      [293.7, 0.08],
      [392, 0.05],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(a, t0 + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.2);
      o.connect(g).connect(this.master!);
      o.start(t0);
      o.stop(t0 + 3.3);
    }
    this.noiseSweep(300, 1800, 1.2, 0.1);
  }

  /** A soft wolf howl: a sine that rises, wavers and falls, through a vowel-ish filter. */
  howl(gain = 0.6): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(330, t0);
    o.frequency.linearRampToValueAtTime(560, t0 + 0.5);
    o.frequency.linearRampToValueAtTime(600, t0 + 1.2);
    o.frequency.linearRampToValueAtTime(420, t0 + 1.9);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vg = ctx.createGain();
    vg.gain.value = 9;
    vib.connect(vg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.18 * gain, t0 + 0.3);
    g.gain.linearRampToValueAtTime(0.14 * gain, t0 + 1.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.1);
    o.connect(f).connect(g).connect(this.master!);
    o.start(t0);
    vib.start(t0);
    o.stop(t0 + 2.2);
    vib.stop(t0 + 2.2);
  }

  /** Short sound effects for talking shadows. */
  chirp(pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(2200 * pitch, t0);
    o.frequency.exponentialRampToValueAtTime(3600 * pitch, t0 + 0.05);
    o.frequency.exponentialRampToValueAtTime(2600 * pitch, t0 + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.12, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    o.connect(g).connect(this.master!);
    o.start(t0);
    o.stop(t0 + 0.16);
  }

  bark(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t0);
    o.frequency.exponentialRampToValueAtTime(190, t0 + 0.16);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.22, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    o.connect(f).connect(g).connect(this.master!);
    o.start(t0);
    o.stop(t0 + 0.22);
    this.noiseSweep(1200, 500, 0.12, 0.06);
  }

  snap(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.noiseSweep(3000, 800, 0.05, 0.25);
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t0);
    o.frequency.exponentialRampToValueAtTime(60, t0 + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    o.connect(g).connect(this.master!);
    o.start(t0);
    o.stop(t0 + 0.12);
  }

  /** Gentle tick while the match is building (pitch rises with the score). */
  tick(level: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.pluck(AudioEngine.degreeToFreq(Math.round(level * 7), 523.3), 0, 0.12);
  }

  private noiseSweep(f0: number, f1: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t0);
  }
}

export const audio = new AudioEngine();
