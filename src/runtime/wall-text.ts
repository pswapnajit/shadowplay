/**
 * Soft, warm text painted onto the wall (titles, creature names, hints).
 */

import { CanvasTexture, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import type { Stage } from '../core/shadow-geom.js';

export class WallText {
  readonly mesh: Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: CanvasTexture;
  private readonly mat: MeshBasicMaterial;
  private current = '';
  private sub = '';
  opacity = 0;
  target = 0;

  constructor(
    private readonly widthM = 1.1,
    private readonly px = 1024,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = px;
    this.canvas.height = px / 4;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mat = new MeshBasicMaterial({
      map: this.tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(new PlaneGeometry(widthM, widthM / 4), this.mat);
    this.mesh.renderOrder = 20;
    this.mesh.frustumCulled = false;
  }

  /** Places the panel on the wall at wall coordinates (u, v). */
  place(stage: Stage, u: number, v: number): void {
    const R = stage.wallRight;
    const U = stage.wallUp;
    const N = stage.wallNormal;
    const m = new Matrix4().set(R[0], U[0], N[0], 0, R[1], U[1], N[1], 0, R[2], U[2], N[2], 0, 0, 0, 0, 1);
    this.mesh.quaternion.setFromRotationMatrix(m);
    const W = stage.wallPoint;
    this.mesh.position.set(
      W[0] + R[0] * u + U[0] * v + N[0] * 0.012,
      W[1] + R[1] * u + U[1] * v + N[1] * 0.012,
      W[2] + R[2] * u + U[2] * v + N[2] * 0.012,
    );
  }

  show(text: string, sub = ''): void {
    if (text !== this.current || sub !== this.sub) {
      this.current = text;
      this.sub = sub;
      this.paint();
    }
    this.target = 1;
  }

  hide(): void {
    this.target = 0;
  }

  update(delta: number): void {
    this.opacity += (this.target - this.opacity) * Math.min(1, delta * 3);
    this.mat.opacity = this.opacity;
    this.mesh.visible = this.opacity > 0.01;
  }

  private paint(): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const big = Math.round(h * (this.sub ? 0.36 : 0.46));
    ctx.font = `italic ${big}px Georgia, 'Noto Serif', 'Times New Roman', serif`;
    ctx.shadowColor = 'rgba(255, 190, 110, 0.9)';
    ctx.shadowBlur = h * 0.08;
    ctx.fillStyle = '#fff1d6';
    ctx.fillText(this.current, w / 2, this.sub ? h * 0.38 : h * 0.52);
    if (this.sub) {
      ctx.shadowBlur = h * 0.05;
      ctx.font = `${Math.round(h * 0.17)}px Georgia, 'Noto Serif', serif`;
      ctx.fillStyle = 'rgba(255, 236, 200, 0.92)';
      ctx.fillText(this.sub, w / 2, h * 0.8);
    }
    this.tex.needsUpdate = true;
  }
}
