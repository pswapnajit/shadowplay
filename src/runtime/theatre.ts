/**
 * The theatre: finds the wall, hangs the lantern over the player's shoulder,
 * reads the hands and turns them into shadow segments every frame.
 */

import {
  AddEquation,
  BackSide,
  CustomBlending,
  OneFactor,
  ZeroFactor,
  Color,
  ConeGeometry,
  createSystem,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  VisibilityState,
  XRPlane,
} from '@iwsdk/core';
import { JOINT_COUNT, JOINT_NAMES, type V3 } from '../core/hand-data.js';
import { HandShadowBuilder, type Stage } from '../core/shadow-geom.js';
import { ShadowRenderer } from './shadow-renderer.js';
import { type HandFrame, state } from './state.js';

/** WebXR Hand Input bulk accessors (not in every lib.dom version). */
interface HandFrameFns {
  fillPoses?(spaces: XRSpace[], base: XRSpace, out: Float32Array): boolean;
  fillJointRadii?(spaces: XRJointSpace[], out: Float32Array): boolean;
}

/** Hand sources other than XR (webcam, demo) write into state.hands themselves. */
export const externalHands = { active: false };

/**
 * Additive light that leaves destination alpha alone. In passthrough the
 * compositor reads alpha as opacity, so ordinary additive blending would
 * turn glows into dark, opaque shapes.
 */
const GLOW_BLEND = {
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: OneFactor,
  blendDst: OneFactor,
  blendEquationAlpha: AddEquation,
  blendSrcAlpha: ZeroFactor,
  blendDstAlpha: OneFactor,
} as const;

const UP: V3 = [0, 1, 0];
const tmpV = new Vector3();
const tmpQ = new Quaternion();
const tmpM = new Matrix4();

export class TheatreSystem extends createSystem({
  planes: { required: [XRPlane] },
}) {
  shadows!: ShadowRenderer;
  private builder!: HandShadowBuilder;
  private dimmer!: Mesh;
  private lantern!: Mesh;
  private lanternGlow!: Mesh;
  private beam!: Mesh;
  /** Desktop preview only: a plaster wall and floor around the stage. */
  private room!: Mesh;
  private floor!: Mesh;
  private placedAt = -1;
  private placedReal = false;
  private sessionStart = 0;
  private time = 0;
  private jointSpaces = new Map<XRInputSource, XRJointSpace[]>();
  private poseBuf = new Float32Array(JOINT_COUNT * 16);
  private radBuf = new Float32Array(JOINT_COUNT);
  private visualsHidden = false;
  /** 0..1, fades the room dimmer in when the show starts. */
  dim = 0;
  /** 0..1 progress of the lantern floating to its place over the shoulder. */
  arrive = 1;
  private arriveFrom: V3 = [0, 0, 0];
  private arriveVia: V3 = [0, 0, 0];
  private lampAt: V3 = [0, 0, 0];
  private litSoundPlayed = true;
  /** Head position when the theatre was placed; big drifts re-place it. */
  private placedHead: V3 = [0, 0, 0];
  private driftT = 0;
  /** Where the lantern is gliding to after a re-placement. */
  private lampGoal: V3 | null = null;
  /** The story's wind: the shadows' sway on the wall (metres); the lantern swings the other way. */
  readonly lanternSway: [number, number] = [0, 0];

  init(): void {
    this.shadows = new ShadowRenderer();
    this.builder = new HandShadowBuilder();
    this.world.createTransformEntity(this.shadows.wall);
    this.shadows.wall.visible = false;

    // A big inverted sphere that gently dims the real room around the stage.
    const dimMat = new MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.dimmer = new Mesh(new SphereGeometry(30, 24, 12), dimMat);
    this.dimmer.renderOrder = -10;
    this.dimmer.frustumCulled = false;
    this.world.createTransformEntity(this.dimmer);

    // The lantern: a warm core and a soft additive halo.
    this.lantern = new Mesh(
      new SphereGeometry(0.018, 20, 12),
      new MeshBasicMaterial({ color: new Color(1.0, 0.86, 0.6) }),
    );
    this.lanternGlow = new Mesh(
      new SphereGeometry(0.07, 20, 12),
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; varying vec3 vN; varying vec3 vV;
          void main() {
            float f = pow(max(dot(vN, vV), 0.0), 2.5);
            float flick = 0.85 + 0.15 * sin(uTime * 9.0) * sin(uTime * 5.3);
            gl_FragColor = vec4(vec3(1.0, 0.7, 0.35) * f * 0.9 * flick, 1.0);
          }`,
        ...GLOW_BLEND,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.lantern.add(this.lanternGlow);
    this.world.createTransformEntity(this.lantern);
    this.lantern.visible = false;

    // A faint beam of light from the lantern to the wall.
    const beamGeo = new ConeGeometry(1, 1, 32, 1, true);
    beamGeo.translate(0, -0.5, 0);
    beamGeo.rotateX(Math.PI / 2); // apex at the origin, opening along -z
    this.beam = new Mesh(
      beamGeo,
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
        vertexShader: /* glsl */ `
          varying float vT; varying vec3 vN; varying vec3 vV;
          void main() {
            vT = -position.z; // 0 at the lantern, 1 at the wall
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uAlpha;
          varying float vT; varying vec3 vN; varying vec3 vV;
          void main() {
            float edge = pow(1.0 - abs(dot(vN, vV)), 1.5);
            float along = smoothstep(0.05, 0.35, vT) * (1.0 - smoothstep(0.75, 1.0, vT));
            float a = (1.0 - edge) * along * uAlpha * (0.9 + 0.1 * sin(uTime * 3.0 + vT * 20.0));
            gl_FragColor = vec4(vec3(1.0, 0.8, 0.5) * a * 0.12, 1.0);
          }`,
        ...GLOW_BLEND,
        transparent: true,
        depthWrite: false,
        side: BackSide,
      }),
    );
    this.beam.frustumCulled = false;
    this.world.createTransformEntity(this.beam);
    this.beam.visible = false;

    // Desktop room: matches the plaster the wall shader paints, so the stage
    // blends into a full wall instead of floating in the dark.
    const plaster = new ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vW;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
        void main() {
          vec3 c = vec3(0.16, 0.14, 0.13) * (0.9 + 0.1 * noise(vW.xy * 40.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.room = new Mesh(new PlaneGeometry(14, 7), plaster);
    this.room.renderOrder = -5;
    this.world.createTransformEntity(this.room);
    this.floor = new Mesh(new PlaneGeometry(14, 14), new MeshBasicMaterial({ color: new Color(0.018, 0.014, 0.011) }));
    this.floor.rotation.x = -Math.PI / 2;
    this.world.createTransformEntity(this.floor);
    this.room.visible = false;
    this.floor.visible = false;

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => {
        if (v === VisibilityState.Visible) {
          // New immersive session: re-place the theatre around the player.
          this.placedAt = -1;
          this.placedReal = false;
          this.sessionStart = this.time;
          this.arrive = 0; // the lantern makes an entrance in every new session
          this.litSoundPlayed = false;
          this.visualsHidden = false;
          this.jointSpaces.clear();
          state.virtualWall = false;
        } else if (v === VisibilityState.NonImmersive) {
          state.virtualWall = true;
          this.placedAt = -1;
        }
      }),
      this.queries.planes.subscribe('qualify', () => {
        // A real wall showed up after we fell back to a virtual one: retry.
        if (!this.placedReal && this.time - this.sessionStart < 8) this.placedAt = -1;
      }),
    );
  }

  update(delta: number, time: number): void {
    if (state.frozen) return;
    this.time = time;
    this.updateHead();
    // If the player shifts seats or stands up, bring the theatre with them.
    const H = state.head.position;
    const drift = Math.hypot(H[0] - this.placedHead[0], H[1] - this.placedHead[1], H[2] - this.placedHead[2]);
    this.driftT = state.stage && drift > 0.3 ? this.driftT + delta : 0;
    if (this.driftT > 1.2) {
      this.driftT = 0;
      this.placedAt = -1;
    }
    if (this.placedAt < 0) this.place();
    if (this.lampGoal && state.stage) {
      const L = state.stage.lamp;
      const k = Math.min(1, delta * 2.5);
      L[0] += (this.lampGoal[0] - L[0]) * k;
      L[1] += (this.lampGoal[1] - L[1]) * k;
      L[2] += (this.lampGoal[2] - L[2]) * k;
      if (this.arrive >= 1) this.lantern.position.set(L[0], L[1], L[2]);
      if (Math.hypot(this.lampGoal[0] - L[0], this.lampGoal[1] - L[1], this.lampGoal[2] - L[2]) < 0.002) this.lampGoal = null;
    }
    if (!externalHands.active) this.readXRHands();
    this.buildHandSegments();

    // The lantern's entrance: it appears in front of the player, then
    // glides over their shoulder, and the wall lights up as it settles.
    if (this.arrive < 1 && state.stage) {
      this.arrive = Math.min(1, this.arrive + delta / 2.8);
      const t = this.arrive;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const a = this.arriveFrom;
      const b = this.arriveVia;
      const c = this.lampAt;
      const u = 1 - e;
      this.lantern.position.set(
        u * u * a[0] + 2 * u * e * b[0] + e * e * c[0],
        u * u * a[1] + 2 * u * e * b[1] + e * e * c[1],
        u * u * a[2] + 2 * u * e * b[2] + e * e * c[2],
      );
      if (t >= 1 && !this.litSoundPlayed) {
        this.litSoundPlayed = true;
        onLanternLit?.();
      }
    }
    const lit = smooth(0.55, 1, this.arrive);
    this.shadows.wallMat.uniforms.uPool.value.w = lit;
    if (this.arrive >= 1 && state.stage && (this.lanternSway[0] !== 0 || this.lanternSway[1] !== 0 || this.lampGoal)) {
      const L = state.stage.lamp;
      const R = state.stage.wallRight;
      const U = state.stage.wallUp;
      const sx = -this.lanternSway[0] * 0.6;
      const sy = -this.lanternSway[1] * 0.6;
      this.lantern.position.set(L[0] + R[0] * sx + U[0] * sy, L[1] + R[1] * sx + U[1] * sy, L[2] + R[2] * sx + U[2] * sy);
    }

    // Theatre visuals.
    const showing = state.stage !== null;
    this.shadows.wall.visible = showing;
    const dimTarget = showing && !state.virtualWall ? 0.42 * lit : 0;
    this.dim += (dimTarget - this.dim) * Math.min(1, delta * 0.8);
    (this.dimmer.material as MeshBasicMaterial).opacity = this.dim;
    this.dimmer.position.set(state.head.position[0], state.head.position[1], state.head.position[2]);
    this.lantern.visible = showing;
    this.beam.visible = showing && !state.virtualWall;
    this.room.visible = showing && state.virtualWall;
    this.floor.visible = showing && state.virtualWall;
    (this.lanternGlow.material as ShaderMaterial).uniforms.uTime.value = time;
    const bm = this.beam.material as ShaderMaterial;
    bm.uniforms.uTime.value = time;
    bm.uniforms.uAlpha.value = (this.dim / 0.42) * lit;
  }

  private updateHead(): void {
    if (this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
      // Desktop preview: a virtual seated puppeteer; the screen camera is
      // just the audience looking at the wall.
      const h = state.head;
      h.position[0] = 0;
      h.position[1] = 1.2;
      h.position[2] = 0;
      h.right[0] = 1;
      h.right[1] = 0;
      h.right[2] = 0;
      h.up[0] = 0;
      h.up[1] = 1;
      h.up[2] = 0;
      h.forward[0] = 0;
      h.forward[1] = 0;
      h.forward[2] = -1;
      return;
    }
    const head = this.player.head;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(tmpV);
    const h = state.head;
    h.position[0] = tmpV.x;
    h.position[1] = tmpV.y;
    h.position[2] = tmpV.z;
    head.getWorldQuaternion(tmpQ);
    tmpV.set(1, 0, 0).applyQuaternion(tmpQ);
    h.right[0] = tmpV.x;
    h.right[1] = tmpV.y;
    h.right[2] = tmpV.z;
    tmpV.set(0, 1, 0).applyQuaternion(tmpQ);
    h.up[0] = tmpV.x;
    h.up[1] = tmpV.y;
    h.up[2] = tmpV.z;
    tmpV.set(0, 0, -1).applyQuaternion(tmpQ);
    h.forward[0] = tmpV.x;
    h.forward[1] = tmpV.y;
    h.forward[2] = tmpV.z;
  }

  /** Re-place the theatre in front of the player (menu action). */
  replace(): void {
    this.placedAt = -1;
  }

  /** Plays the opening again: the lantern's entrance and the wall lighting up. */
  restartShow(): void {
    this.arrive = 0;
    this.litSoundPlayed = false;
    this.dim = 0;
    state.stage = null;
    this.placedAt = -1;
  }

  private place(): void {
    const H = state.head.position;
    // Level the head frame: the theatre stands upright regardless of head tilt.
    let fx = state.head.forward[0];
    let fz = state.head.forward[2];
    const fl = Math.hypot(fx, fz);
    if (fl < 0.2) return; // looking straight up/down; wait
    fx /= fl;
    fz /= fl;
    const F: V3 = [fx, 0, fz];
    const R: V3 = [-fz, 0, fx];
    const s = state.settings.lampSide === 'right' ? 1 : -1;

    const lamp: V3 = [
      H[0] + R[0] * 0.32 * s - F[0] * 0.28,
      H[1] - 0.06,
      H[2] + R[2] * 0.32 * s - F[2] * 0.28,
    ];
    // Where a comfortably held hand sits.
    const hand: V3 = [H[0] + F[0] * 0.4 + R[0] * 0.05 * s, H[1] - 0.08, H[2] + F[2] * 0.4 + R[2] * 0.05 * s];
    const D = norm([hand[0] - lamp[0], hand[1] - lamp[1], hand[2] - lamp[2]]);

    // Look for a real wall the light would land on.
    let best: { t: number; n: V3 } | null = null;
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as XRPlane | undefined;
      const obj = entity.object3D;
      if (!plane || !obj || plane.orientation !== 'vertical') continue;
      obj.updateWorldMatrix(true, false);
      tmpM.copy(obj.matrixWorld);
      const P0: V3 = [tmpM.elements[12], tmpM.elements[13], tmpM.elements[14]];
      let n: V3 = norm([tmpM.elements[4], tmpM.elements[5], tmpM.elements[6]]); // plane +Y
      if (dot(n, [H[0] - P0[0], H[1] - P0[1], H[2] - P0[2]]) < 0) n = [-n[0], -n[1], -n[2]];
      const dn = dot(D, n);
      if (dn > -0.35) continue; // light would graze the wall
      const t = dot([P0[0] - lamp[0], P0[1] - lamp[1], P0[2] - lamp[2]], n) / dn;
      if (t < 0.9 || t > 4.5) continue;
      // Must land inside the plane's polygon (approximate with its bounds).
      const hit: V3 = [lamp[0] + D[0] * t, lamp[1] + D[1] * t, lamp[2] + D[2] * t];
      if (!insidePlane(plane, obj.matrixWorld, hit)) continue;
      if (!best || t < best.t) best = { t, n };
    }

    let wallPoint: V3;
    let N: V3;
    if (best) {
      N = best.n;
      wallPoint = [lamp[0] + D[0] * best.t, lamp[1] + D[1] * best.t, lamp[2] + D[2] * best.t];
      this.placedReal = true;
      state.realWall = true;
    } else {
      // No wall found (yet): hang a virtual screen 1.6 m ahead.
      N = [-F[0], 0, -F[2]];
      const P0: V3 = [H[0] + F[0] * 1.6, H[1], H[2] + F[2] * 1.6];
      const t = dot([P0[0] - lamp[0], P0[1] - lamp[1], P0[2] - lamp[2]], N) / dot(D, N);
      wallPoint = [lamp[0] + D[0] * t, lamp[1] + D[1] * t, lamp[2] + D[2] * t];
      state.realWall = false;
    }
    let U = sub(UP, scale(N, dot(UP, N)));
    U = norm(U);
    const Rw = cross(U, N);
    // Re-placement: glide the lantern from where it was instead of jumping.
    const previousLamp = state.stage && this.arrive >= 1 ? ([...state.stage.lamp] as V3) : null;
    this.placedHead = [H[0], H[1], H[2]];
    const stage: Stage = {
      lamp: previousLamp ?? lamp,
      wallPoint,
      wallNormal: N,
      wallRight: Rw,
      wallUp: U,
      lampRadius: 0.012,
    };
    state.stage = stage;
    this.lampGoal = previousLamp ? lamp : null;
    this.shadows.placeWall(stage, state.regionSize);
    this.shadows.wallMat.uniforms.uVirtualWall.value = state.virtualWall ? 1 : 0;
    this.lampAt = lamp;
    if (this.arrive < 1) {
      // entrance path: from just in front of the player, arcing up and over the shoulder
      this.arriveFrom = [H[0] + F[0] * 0.45, H[1] - 0.04, H[2] + F[2] * 0.45];
      this.arriveVia = [H[0] + F[0] * 0.25 + R[0] * 0.45 * s, H[1] + 0.22, H[2] + F[2] * 0.25 + R[2] * 0.45 * s];
      this.lantern.position.set(this.arriveFrom[0], this.arriveFrom[1], this.arriveFrom[2]);
    } else {
      this.lantern.position.set(stage.lamp[0], stage.lamp[1], stage.lamp[2]);
    }
    // Desktop room sits just behind the stage plane.
    this.room.position.set(wallPoint[0] - N[0] * 0.01, wallPoint[1] + 1.2, wallPoint[2] - N[2] * 0.01);
    this.room.lookAt(wallPoint[0] + N[0], wallPoint[1] + 1.2, wallPoint[2] + N[2]);
    this.floor.position.set(H[0], 0, H[2]);
    // Beam: apex at the lantern, opening towards the pool centre.
    const L = Math.hypot(wallPoint[0] - lamp[0], wallPoint[1] - lamp[1], wallPoint[2] - lamp[2]);
    this.beam.position.set(lamp[0], lamp[1], lamp[2]);
    this.beam.lookAt(2 * lamp[0] - wallPoint[0], 2 * lamp[1] - wallPoint[1], 2 * lamp[2] - wallPoint[2]);
    this.beam.scale.set(0.55, 0.55, L);
    this.placedAt = this.time;
  }

  private readXRHands(): void {
    const frame = this.world.xrFrame;
    const session = this.world.xrSession;
    const ref = this.world.xrReferenceSpace;
    state.hands[0].tracked = false;
    state.hands[1].tracked = false;
    if (!frame || !session || !ref) {
      state.handSource = 'none';
      return;
    }
    if (!this.visualsHidden) {
      // Real hands are visible in passthrough; don't draw virtual ones on top.
      const hv = this.input.xr.visualAdapters.hand;
      hv.left.toggleVisual(false);
      hv.right.toggleVisual(false);
      this.visualsHidden = true;
    }
    this.player.updateWorldMatrix(true, false);
    const pm = this.player.matrixWorld.elements;
    // Controllers in hand means no hand tracking: the game asks the player to put them down.
    let controllers = 0;
    for (const source of session.inputSources) if (!source.hand && source.gamepad) controllers++;
    state.controllersInHand = controllers > 0;
    for (const source of session.inputSources) {
      const hand = source.hand;
      if (!hand || (source.handedness !== 'left' && source.handedness !== 'right')) continue;
      let spaces = this.jointSpaces.get(source);
      if (!spaces) {
        spaces = JOINT_NAMES.map((n) => hand.get(n as XRHandJoint)!).filter(Boolean);
        this.jointSpaces.set(source, spaces);
      }
      if (spaces.length !== JOINT_COUNT) continue;
      const f = frame as XRFrame & HandFrameFns;
      const ok = f.fillPoses?.(spaces, ref, this.poseBuf) && f.fillJointRadii?.(spaces, this.radBuf);
      if (!ok) continue;
      const out: HandFrame = source.handedness === 'left' ? state.hands[0] : state.hands[1];
      for (let i = 0; i < JOINT_COUNT; i++) {
        const x = this.poseBuf[i * 16 + 12];
        const y = this.poseBuf[i * 16 + 13];
        const z = this.poseBuf[i * 16 + 14];
        out.joints[i * 3] = pm[0] * x + pm[4] * y + pm[8] * z + pm[12];
        out.joints[i * 3 + 1] = pm[1] * x + pm[5] * y + pm[9] * z + pm[13];
        out.joints[i * 3 + 2] = pm[2] * x + pm[6] * y + pm[10] * z + pm[14];
        out.radii[i] = this.radBuf[i];
      }
      out.tracked = true;
      state.handSource = 'xr';
    }
  }

  private buildHandSegments(): void {
    const stage = state.stage;
    let count = 0;
    let mag = 0;
    let magN = 0;
    if (stage) {
      for (const h of state.hands) {
        if (!h.tracked) continue;
        const n = this.builder.build(stage, h.joints, h.radii, h.side, state.head, state.handSegs, count);
        if (n === 0) continue;
        // magnification of the wrist: projected radius / joint radius
        const m = state.handSegs[count * 8 + 2] / Math.max(1e-4, h.radii[0]);
        if (m > 7) continue; // hand right up against the lantern: no sensible shadow
        mag += m;
        magN++;
        count += n;
      }
    }
    state.handSegCount = count;
    if (magN > 0) state.magnification = mag / magN;
  }
}

/** Draws the shadow passes and feeds the wall shader; runs after the game logic. */
export class ShadowDrawSystem extends createSystem({}) {
  theatre: TheatreSystem | null = null;

  update(_delta: number, time: number): void {
    if (state.frozen) return;
    const t = this.theatre;
    const stage = state.stage;
    if (!t || !stage) return;
    const r = t.shadows;
    const u = r.wallMat.uniforms;
    u.uTime.value = time;
    u.uContrast.value = state.settings.highContrast ? 2 : 1;
    u.uVirtualWall.value = state.virtualWall ? 1 : 0;
    // Penumbra in texels: lamp radius × (magnification − 1) on the wall.
    // The 9-tap kernel has sigma ≈ 2 taps, so scale the tap spacing to give
    // a 10–90% edge about as wide as the real penumbra.
    const penumbra = stage.lampRadius * Math.max(0.5, state.magnification - 1);
    const blurPx = (penumbra / state.regionSize) * 256 * 0.45;
    r.draw(
      this.world.renderer,
      state.handSegs,
      state.handSegCount,
      state.creatureSegs,
      state.creatureAlpha,
      state.creatureSegCount,
      state.regionSize,
      blurPx,
    );
  }
}

/** Called once when the lantern settles into place (sound hook). */
export let onLanternLit: (() => void) | null = null;
export function setOnLanternLit(fn: () => void): void {
  onLanternLit = fn;
}

// ------------------------------------------------------------------ helpers
function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a: V3, s: number): V3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

const inv = new Matrix4();
const local = new Vector3();
/** Point-in-polygon test in the plane's own space (x/z), with a small margin. */
function insidePlane(plane: XRPlane, world: Matrix4, p: V3): boolean {
  inv.copy(world).invert();
  local.set(p[0], p[1], p[2]).applyMatrix4(inv);
  const poly = plane.polygon;
  if (!poly || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].z;
    const xj = poly[j].x;
    const zj = poly[j].z;
    if (zi > local.z !== zj > local.z && local.x < ((xj - xi) * (local.z - zi)) / (zj - zi + 1e-9) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
