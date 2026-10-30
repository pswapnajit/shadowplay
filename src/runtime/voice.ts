/**
 * The Lantern's speaking voice: the device's own speech synthesis, reading
 * each narration line aloud while the words appear on the wall. Where there's
 * no suitable voice, the Lantern keeps its wordless murmur instead.
 */

/** Warm, unhurried storytelling voices, best first (whatever the device has). */
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

export class LanternVoice {
  private readonly synth: SpeechSynthesis | null = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  private voice: SpeechSynthesisVoice | null = null;
  /** The player's choice (remembered); speaking also needs a voice to exist. */
  wanted = true;
  /** True while a line is being spoken. */
  speaking = false;
  /** `?voice=silent`: keep the voice's timing but make no sound (recording; the video adds the voice in post). */
  private silent = false;

  constructor() {
    try {
      this.wanted = localStorage.getItem(KEY) !== 'off';
    } catch {
      /* default on */
    }
    const param = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('voice') : null;
    if (param === 'off') this.wanted = false;
    this.silent = param === 'silent';
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

  get available(): boolean {
    return !!this.voice;
  }

  get on(): boolean {
    return this.wanted && !!this.voice;
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
    return this.voice?.name ?? '';
  }

  /** Speaks a line; `onWord` gets the character index of each word as it's spoken. */
  speak(text: string, onWord?: (charIndex: number) => void): void {
    if (!this.on || !this.synth) return;
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = this.voice;
    u.lang = this.voice!.lang;
    u.rate = 0.92;
    u.pitch = 1;
    u.volume = this.silent ? 0 : 1;
    u.onboundary = (e) => {
      if (e.name === 'word' || e.name === undefined) onWord?.(e.charIndex);
    };
    u.onend = u.onerror = () => {
      this.speaking = false;
    };
    this.speaking = true;
    this.synth.speak(u);
  }

  cancel(): void {
    this.synth?.cancel();
    this.speaking = false;
  }
}

export const voice = new LanternVoice();
