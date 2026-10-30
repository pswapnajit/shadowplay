/**
 * Procedural sound: everything is synthesised with Web Audio, so there are
 * no assets to license and nothing to download. Creature sounds are spatial:
 * each comes from its creature's place on the wall, and the Lantern murmurs
 * from over the player's shoulder, wherever they turn their head.
 */

import type { HeadFrame, Stage } from '../core/shadow-geom.js';

const PENT = [0, 2, 4, 7, 9];

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private plucks = new Map<number, AudioBuffer>();
  muted = false;
  /** The theatre, for placing sounds on its wall. */
  private stage: Stage | null = null;
  /** The Lantern's own voice comes from the lantern. */
  private lanternOut: PannerNode | null = null;
  /** In the headset the Lantern speaks from over the shoulder; on a screen, straight out. */
  private immersive = false;
  /** `?record`: the voice stays centred (a recording is heard on speakers, not in the room). */
  private readonly centred = typeof location !== 'undefined' && new URLSearchParams(location.search).has('record');

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

  /** A stream of everything the game plays, for recording the demo video. */
  captureStream(): MediaStream | null {
    if (!this.ctx || !this.master) return null;
    const dest = this.ctx.createMediaStreamDestination();
    this.master.connect(dest);
    return dest.stream;
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

  /**
   * Called every frame: the listener follows the player's head, and the
   * Lantern's voice follows the lantern.
   */
  listen(head: HeadFrame, stage: Stage | null, immersive = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.stage = stage;
    this.immersive = immersive;
    const L = ctx.listener;
    const [px, py, pz] = head.position;
    const f = head.forward;
    const u = head.up;
    if (L.positionX) {
      L.positionX.value = px;
      L.positionY.value = py;
      L.positionZ.value = pz;
      L.forwardX.value = f[0];
      L.forwardY.value = f[1];
      L.forwardZ.value = f[2];
      L.upX.value = u[0];
      L.upY.value = u[1];
      L.upZ.value = u[2];
    } else {
      L.setPosition(px, py, pz);
      L.setOrientation(f[0], f[1], f[2], u[0], u[1], u[2]);
    }
    if (stage) {
      this.lanternOut ??= this.panner();
      setPannerAt(this.lanternOut, stage.lamp[0], stage.lamp[1], stage.lamp[2]);
    }
  }

  private panner(): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2;
    p.rolloffFactor = 0.5;
    p.connect(this.master!);
    return p;
  }

  /** Where a sound at wall point (x, y) plays from: a spatial panner when the theatre is up, else straight out. */
  private onWall(x?: number, y = 0): AudioNode {
    const st = this.stage;
    if (x === undefined || !st) return this.master!;
    const W = st.wallPoint;
    const R = st.wallRight;
    const U = st.wallUp;
    const p = this.panner();
    setPannerAt(p, W[0] + R[0] * x + U[0] * y, W[1] + R[1] * x + U[1] * y, W[2] + R[2] * x + U[2] * y);
    return p;
  }

  /**
   * A line in the Lantern's own voice, from the lantern itself. The room tone
   * dips a little while it speaks. Returns the playing source (or null before
   * the sound has started).
   */
  playVoice(buf: AudioBuffer, volume = 1): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = this.muted ? 0 : volume;
    src.connect(g).connect(this.immersive && this.lanternOut && !this.centred ? this.lanternOut : this.master);
    const amb = this.ambience?.gain;
    amb?.setTargetAtTime(Math.min(amb.value, 0.6), ctx.currentTime, 0.2);
    src.addEventListener('ended', () => amb?.setTargetAtTime(this.ambienceLevel, ctx.currentTime, 0.6));
    src.start();
    return src;
  }

  private ambienceLevel = 0;

  /** Fade the ambience in or out (0..1). */
  setAmbience(level: number): void {
    this.ambienceLevel = level;
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

  /** One plucked note: `out` is a stereo pan (-1..1) or a node to play through. */
  pluck(freq: number, when = 0, gain = 0.5, out: number | AudioNode = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const src = ctx.createBufferSource();
    src.buffer = this.pluckBuffer(freq);
    const g = ctx.createGain();
    g.gain.value = gain;
    if (typeof out === 'number') {
      const p = ctx.createStereoPanner();
      p.pan.value = out;
      src.connect(g).connect(p).connect(this.master!);
    } else src.connect(g).connect(out);
    src.start(ctx.currentTime + when);
  }

  /** A creature's little song, on a plucked string, from where it stands on the wall (x, y). */
  song(degrees: number[], tempo = 0.16, x?: number, y = 0): void {
    if (!this.ctx || this.muted) return;
    const out = this.onWall(x, y);
    degrees.forEach((d, i) => this.pluck(AudioEngine.degreeToFreq(d), i * tempo, 0.4, out));
  }

  /** Bell-like shimmer when a shadow wakes up, where it wakes. */
  awaken(x?: number, y = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const out = this.onWall(x, y);
    const t0 = ctx.currentTime;
    [523.3, 784, 1046.5, 1568].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + i * 0.07);
      g.gain.linearRampToValueAtTime(0.16 / (i + 1), t0 + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.07 + 2.2);
      o.connect(g).connect(out);
      o.start(t0 + i * 0.07);
      o.stop(t0 + 2.5);
    });
    // breathy whoosh
    this.noiseSweep(400, 3000, 0.9, 0.12, out);
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
  howl(gain = 0.6, x?: number, y = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const out = this.onWall(x, y);
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
    o.connect(f).connect(g).connect(out);
    o.start(t0);
    vib.start(t0);
    o.stop(t0 + 2.2);
    vib.stop(t0 + 2.2);
  }

  /** Short sound effects for talking shadows, from where each one is on the wall. */
  chirp(pitch = 1, x?: number, y = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const out = this.onWall(x, y);
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
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + 0.16);
  }

  bark(x?: number, y = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const out = this.onWall(x, y);
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
    o.connect(f).connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + 0.22);
    this.noiseSweep(1200, 500, 0.12, 0.06, out);
  }

  snap(x?: number, y = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const out = this.onWall(x, y);
    this.noiseSweep(3000, 800, 0.05, 0.25, out);
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t0);
    o.frequency.exponentialRampToValueAtTime(60, t0 + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + 0.12);
  }

  // --- the story stage ----------------------------------------------------

  private beds = new Map<string, GainNode>();
  private noiseBuf: AudioBuffer | null = null;

  private noiseLoop(): AudioBufferSourceNode {
    const ctx = this.ctx!;
    if (!this.noiseBuf) {
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.loopStart = Math.random();
    return src;
  }

  /** An LFO driving `param` around its current value by ±depth. */
  private lfo(param: AudioParam, freq: number, depth: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start();
  }

  /** Weather and night sounds that run until faded out (`level` 0). */
  bed(name: 'rain' | 'wind' | 'crickets', level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    let g = this.beds.get(name);
    if (!g) {
      if (level <= 0) return;
      g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      this.beds.set(name, g);
      if (name === 'rain') {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 500;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 4200;
        const src = this.noiseLoop();
        src.connect(hp).connect(lp).connect(g);
        src.start();
        // heavier drops on a lower band, gusting slowly
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 900;
        bp.Q.value = 0.8;
        const gust = ctx.createGain();
        gust.gain.value = 0.5;
        this.lfo(gust.gain, 0.09, 0.35);
        const src2 = this.noiseLoop();
        src2.connect(bp).connect(gust).connect(g);
        src2.start();
      } else if (name === 'wind') {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 520;
        bp.Q.value = 1.4;
        this.lfo(bp.frequency, 0.11, 260);
        const swell = ctx.createGain();
        swell.gain.value = 0.7;
        this.lfo(swell.gain, 0.07, 0.3);
        const src = this.noiseLoop();
        src.connect(bp).connect(swell).connect(g);
        src.start();
      } else {
        // two crickets: a high tone, trilled, in bursts
        for (const [f, trill, burst] of [
          [4500, 27, 0.62],
          [4920, 31, 0.47],
        ] as const) {
          const o = ctx.createOscillator();
          o.frequency.value = f;
          const a1 = ctx.createGain();
          a1.gain.value = 0.5;
          this.lfo(a1.gain, trill, 0.5, 'square');
          const a2 = ctx.createGain();
          a2.gain.value = 0.5;
          this.lfo(a2.gain, burst, 0.5, 'square');
          const pan = ctx.createStereoPanner();
          pan.pan.value = f > 4700 ? 0.6 : -0.5;
          o.connect(a1).connect(a2).connect(pan).connect(g);
          o.start();
        }
      }
    }
    const peak = name === 'rain' ? 0.16 : name === 'wind' ? 0.2 : 0.012;
    g.gain.setTargetAtTime(Math.max(0, level) * peak, ctx.currentTime, level > 0 ? 0.9 : 0.6);
  }

  /** Thunder: a crack, then a long low roll. */
  thunder(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime;
    this.noiseSweep(2600, 300, 0.35, 0.16);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 170;
    lp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.9, t0 + 0.12);
    g.gain.setTargetAtTime(0.45, t0 + 0.4, 0.4);
    g.gain.setTargetAtTime(0.0001, t0 + 1.4, 0.9);
    const src = this.noiseLoop();
    src.connect(lp).connect(g).connect(this.master!);
    src.start(t0);
    src.stop(t0 + 5);
  }

  /** A soft chord swell: cool and high for the moon, warm for dawn. */
  swell(kind: 'moon' | 'dawn'): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime;
    const notes = kind === 'moon' ? [659.3, 830.6, 987.8, 1318.5] : [261.6, 329.6, 392, 523.3];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      const peak = (kind === 'moon' ? 0.035 : 0.06) / (1 + i * 0.4);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 1.4 + i * 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 5.5);
      o.connect(g).connect(this.master!);
      o.start(t0);
      o.stop(t0 + 5.6);
    });
  }

  /** A few high plucks, like light catching on something. */
  sparkle(n = 5): void {
    for (let i = 0; i < n; i++) {
      this.pluck(AudioEngine.degreeToFreq(7 + Math.floor(Math.random() * 6), 523.3), i * 0.11 + Math.random() * 0.05, 0.12, Math.random() * 1.4 - 0.7);
    }
  }

  /** Dawn chorus: chirps scattered over a few seconds. */
  birdsong(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    // from all over the wall, high up, like birds waking in the trees
    for (let i = 0; i < 7; i++) setTimeout(() => this.chirp(0.8 + Math.random() * 0.5, Math.random() * 1.8 - 0.9, 0.3 + Math.random() * 0.5), 400 + i * 520 + Math.random() * 300);
  }

  /**
   * Lantern-speak: one soft, wordless syllable per word as the narration
   * appears, so the Lantern seems to murmur the story.
   */
  voice(semitones: number, gain = 0.045): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime;
    const f = 294 * Math.pow(2, semitones / 12);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f * 1.04, t0);
    o.frequency.exponentialRampToValueAtTime(f, t0 + 0.06);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    o.connect(lp).connect(g).connect(this.lanternOut ?? this.master!);
    o.start(t0);
    o.stop(t0 + 0.18);
  }

  /** Gentle tick while the match is building (pitch rises with the score). */
  tick(level: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.pluck(AudioEngine.degreeToFreq(Math.round(level * 7), 523.3), 0, 0.12);
  }

  private noiseSweep(f0: number, f1: number, dur: number, gain: number, out: AudioNode = this.master!): void {
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
    src.connect(f).connect(g).connect(out);
    src.start(t0);
  }
}

function setPannerAt(p: PannerNode, x: number, y: number, z: number): void {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else p.setPosition(x, y, z);
}

export const audio = new AudioEngine();
