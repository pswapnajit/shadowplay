/**
 * The Lantern's words on the wall: one narration line at a time, revealed
 * word by word at a storyteller's pace, like a page being read aloud.
 */

import { CanvasTexture, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import type { Stage } from '../core/shadow-geom.js';

const W = 1280;
const H = 300;
const FONT = "Georgia, 'Noto Serif', 'Times New Roman', serif";

/** Seconds before a word appears, after the previous one (punctuation earns a pause). */
function wordPause(word: string): number {
  if (/[.!?…]["”’)]?$/.test(word)) return 0.62;
  if (/[,;:—–-]["”’)]?$/.test(word)) return 0.42;
  return 0.27 + Math.min(0.12, word.length * 0.012);
}

export class NarrationPanel {
  readonly mesh: Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: CanvasTexture;
  private readonly mat: MeshBasicMaterial;
  private words: string[] = [];
  private at: number[] = [];
  private pos: { x: number; y: number }[] = [];
  private fontPx = 54;
  private shown = 0;
  private t = 0;
  private end = 0;
  private opacity = 0;
  private target = 0;
  private thinking = false;
  private thinkT = 0;
  /** Called as each word appears (for the Lantern's murmur). */
  onWord: ((word: string, index: number, count: number) => void) | null = null;

  // 1.5 m keeps a line within ~45° at a typical wall distance (comfortable on every Quest's field of view).
  constructor(private readonly widthM = 1.5) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mat = new MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide });
    this.mesh = new Mesh(new PlaneGeometry(widthM, (widthM * H) / W), this.mat);
    this.mesh.renderOrder = 21;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  place(stage: Stage, u: number, v: number): void {
    const R = stage.wallRight;
    const U = stage.wallUp;
    const N = stage.wallNormal;
    const m = new Matrix4().set(R[0], U[0], N[0], 0, R[1], U[1], N[1], 0, R[2], U[2], N[2], 0, 0, 0, 0, 1);
    this.mesh.quaternion.setFromRotationMatrix(m);
    const P = stage.wallPoint;
    this.mesh.position.set(
      P[0] + R[0] * u + U[0] * v + N[0] * 0.014,
      P[1] + R[1] * u + U[1] * v + N[1] * 0.014,
      P[2] + R[2] * u + U[2] * v + N[2] * 0.014,
    );
  }

  /** Starts a new line. Returns how long it will take to read, in seconds. */
  speak(text: string): number {
    this.words = text.split(/\s+/).filter(Boolean);
    this.thinking = false;
    this.layout();
    this.at = [];
    let t = 0.15;
    for (const w of this.words) {
      this.at.push(t);
      t += wordPause(w);
    }
    // time to take the line in once it's all there
    this.end = t + 1.1 + Math.min(1.6, this.words.length * 0.05);
    this.t = 0;
    this.shown = 0;
    this.target = 1;
    this.paint();
    return this.end;
  }

  /** True once the current line has been revealed and held. */
  get done(): boolean {
    return this.t >= this.end;
  }

  /** Skips to the end of the current line (debug, director). */
  finish(): void {
    this.t = this.end;
  }

  /** "· · ·" while the Lantern gathers its thoughts. */
  setThinking(on: boolean): void {
    if (on === this.thinking) return;
    this.thinking = on;
    if (on) {
      this.words = [];
      this.thinkT = 0;
      this.target = 1;
      this.paint();
    }
  }

  hide(): void {
    this.target = 0;
    this.thinking = false;
  }

  update(dt: number): void {
    this.t += dt;
    let n = this.shown;
    while (n < this.words.length && this.at[n] <= this.t) n++;
    if (n !== this.shown) {
      for (let i = this.shown; i < n; i++) this.onWord?.(this.words[i], i, this.words.length);
      this.shown = n;
      this.paint();
    }
    let o = this.target;
    if (this.thinking) {
      this.thinkT += dt;
      o *= 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(this.thinkT * 3.2));
    }
    this.opacity += (o - this.opacity) * Math.min(1, dt * 4);
    this.mat.opacity = this.opacity;
    this.mesh.visible = this.opacity > 0.01;
  }

  /** Wraps the line into at most three centred rows, shrinking the font if it must. */
  private layout(): void {
    const ctx = this.ctx;
    for (this.fontPx = 66; this.fontPx >= 34; this.fontPx -= 4) {
      ctx.font = `italic ${this.fontPx}px ${FONT}`;
      const space = ctx.measureText(' ').width;
      const rows: { idx: number[]; w: number }[] = [{ idx: [], w: 0 }];
      for (let i = 0; i < this.words.length; i++) {
        const ww = ctx.measureText(this.words[i]).width;
        const row = rows[rows.length - 1];
        const need = row.idx.length ? row.w + space + ww : ww;
        if (need > W * 0.92 && row.idx.length) rows.push({ idx: [i], w: ww });
        else {
          row.idx.push(i);
          row.w = need;
        }
      }
      if (rows.length <= 3 || this.fontPx <= 34) {
        const lineH = this.fontPx * 1.32;
        const top = H / 2 - ((rows.length - 1) * lineH) / 2;
        this.pos = new Array(this.words.length);
        rows.forEach((row, r) => {
          let x = (W - row.w) / 2;
          for (const i of row.idx) {
            this.pos[i] = { x, y: top + r * lineH };
            x += ctx.measureText(this.words[i]).width + space;
          }
        });
        return;
      }
    }
  }

  private paint(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(255, 190, 110, 0.85)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#fff1d6';
    if (this.thinking) {
      ctx.textAlign = 'center';
      ctx.font = `${Math.round(H * 0.3)}px ${FONT}`;
      ctx.fillText('·  ·  ·', W / 2, H / 2);
    } else {
      ctx.font = `italic ${this.fontPx}px ${FONT}`;
      for (let i = 0; i < this.shown; i++) ctx.fillText(this.words[i], this.pos[i].x, this.pos[i].y);
    }
    this.tex.needsUpdate = true;
  }
}
