/**
 * The "show me" ghost: a translucent golden hand that forms the creature's
 * pose right where the player's own hand belongs, so the game can teach
 * shapes without walls of text.
 */

import {
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import type { CreatureDef } from '../core/creatures.js';
import { JOINT_COUNT, REST, SHADOW_BONES } from '../core/hand-data.js';
import { placeSpec } from './demo-hands.js';

const MAX_HANDS = 2;
const BONES = SHADOW_BONES.filter(([a, b]) => b - a === 1 || a === 0); // skeleton bones only

export class GhostHand {
  readonly root = new Object3D();
  /** When set, draws these live hands instead of a creature demo. */
  live: { tracked: boolean; joints: Float32Array }[] | null = null;
  baseOpacity = 0.42;
  private readonly joints: InstancedMesh;
  private readonly bones: InstancedMesh;
  private readonly mat: MeshBasicMaterial;
  private readonly buf = [new Float32Array(JOINT_COUNT * 3), new Float32Array(JOINT_COUNT * 3)];
  private creature: CreatureDef | null = null;
  private t = 0;
  private opacity = 0;
  private visible = false;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly s = new Vector3();

  constructor(color = 0xffd08a) {
    this.mat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.joints = new InstancedMesh(new SphereGeometry(1, 12, 8), this.mat, JOINT_COUNT * MAX_HANDS);
    this.bones = new InstancedMesh(new CylinderGeometry(1, 1, 1, 10, 1, true), this.mat, BONES.length * MAX_HANDS);
    this.joints.instanceMatrix.setUsage(DynamicDrawUsage);
    this.bones.instanceMatrix.setUsage(DynamicDrawUsage);
    this.joints.frustumCulled = false;
    this.bones.frustumCulled = false;
    this.joints.renderOrder = 30;
    this.bones.renderOrder = 30;
    this.root.add(this.joints, this.bones);
    this.root.visible = false;
  }

  show(c: CreatureDef): void {
    if (this.creature !== c) this.t = 0;
    this.creature = c;
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  update(dt: number): void {
    const target = this.visible ? this.baseOpacity : 0;
    this.opacity += (target - this.opacity) * Math.min(1, dt * 4);
    this.mat.opacity = this.opacity;
    this.root.visible = this.opacity > 0.01 && (this.creature !== null || this.live !== null);
    if (!this.root.visible) return;
    this.t += dt;
    const hands: Float32Array[] = [];
    let bobAmp = 0.004;
    if (this.live) {
      for (const h of this.live) if (h.tracked) hands.push(h.joints);
      bobAmp = 0;
    } else if (this.creature) {
      const c = this.creature;
      // Demonstrate the motion: beaks open and close, others breathe.
      const k = c.alt ? 0.5 - 0.5 * Math.cos(this.t * 2.2) : 0;
      c.hands.forEach((spec, h) => {
        placeSpec(spec, this.buf[h], c.alt?.[h], k);
        hands.push(this.buf[h]);
      });
    }
    let ji = 0;
    let bi = 0;
    hands.forEach((j, h) => {
      const bob = Math.sin(this.t * 1.4 + h) * bobAmp;
      for (let i = 0; i < JOINT_COUNT; i++) {
        const r = REST[i].r * 0.85;
        this.m.makeScale(r, r, r);
        this.m.setPosition(j[i * 3], j[i * 3 + 1] + bob, j[i * 3 + 2]);
        this.joints.setMatrixAt(ji++, this.m);
      }
      for (const [ia, ib] of BONES) {
        this.a.set(j[ia * 3], j[ia * 3 + 1] + bob, j[ia * 3 + 2]);
        this.b.set(j[ib * 3], j[ib * 3 + 1] + bob, j[ib * 3 + 2]);
        const len = this.a.distanceTo(this.b);
        const r = Math.min(REST[ia].r, REST[ib].r) * 0.8;
        this.s.subVectors(this.b, this.a).normalize();
        this.q.setFromUnitVectors(this.up, this.s);
        this.m.compose(this.a.add(this.b).multiplyScalar(0.5), this.q, this.s.set(r, len, r));
        this.bones.setMatrixAt(bi++, this.m);
      }
    });
    this.joints.count = ji;
    this.bones.count = bi;
    this.joints.instanceMatrix.needsUpdate = true;
    this.bones.instanceMatrix.needsUpdate = true;
  }
}
