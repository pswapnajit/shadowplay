/**
 * GPU side of the shadow theatre.
 *
 * 1. Segment pass: every capsule (hand bone or creature part) is drawn as an
 *    instanced quad covering only its own bounds into a small render target,
 *    MAX-blended so overlapping parts union cleanly. R = hands, G = creatures.
 * 2. Blur pass: a separable Gaussian sized to the lamp's penumbra.
 * 3. Wall: a transparent plane on the real (or virtual) wall that paints the
 *    warm light pool, darkens shadowed areas, and draws the target outline.
 */

import {
  BufferAttribute,
  CustomBlending,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  MaxEquation,
  Mesh,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  RedFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer,
  Matrix4,
  ClampToEdgeWrapping,
  NoBlending,
} from '@iwsdk/core';
import { BONES_PER_HAND } from '../core/hand-data.js';
import { NORM_EXTENT, type Target } from '../core/match.js';
import { Grid, sdfField } from '../core/raster.js';
import { SEG_STRIDE, type Stage } from '../core/shadow-geom.js';
import { MAX_SEGMENTS } from './state.js';

const RT_SIZE = 256;
const TARGET_TEX = 128;

const SD_CAPSULE = /* glsl */ `
float cro(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
float sdUnevenCapsule(vec2 p, vec2 pa, vec2 pb, float ra, float rb) {
  p -= pa;
  pb -= pa;
  float h = dot(pb, pb);
  float bd = ra - rb;
  if (h <= bd * bd + 1e-10) {
    return ra >= rb ? length(p) - ra : length(p - pb) - rb;
  }
  vec2 q = vec2(dot(p, vec2(pb.y, -pb.x)), dot(p, pb)) / h;
  q.x = abs(q.x);
  vec2 c = vec2(sqrt(h - bd * bd), bd);
  float k = cro(c, q);
  float m = dot(c, q);
  float n = dot(q, q);
  if (k < 0.0) return sqrt(h * n) - ra;
  if (k > c.x) return sqrt(h * (n + 1.0 - 2.0 * q.y)) - rb;
  return m - ra;
}
`;

export class ShadowRenderer {
  readonly wall: Mesh;
  readonly shadowTexture: WebGLRenderTarget;

  private readonly segScene = new Scene();
  private readonly segCamera = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private readonly segGeo: InstancedBufferGeometry;
  private readonly aA: InstancedBufferAttribute;
  private readonly aB: InstancedBufferAttribute;
  private readonly aC: InstancedBufferAttribute;
  private readonly segMat: ShaderMaterial;

  private readonly rtA: WebGLRenderTarget;
  private readonly rtB: WebGLRenderTarget;
  private readonly blurScene = new Scene();
  private readonly blurMat: ShaderMaterial;

  readonly wallMat: ShaderMaterial;
  private readonly targetTex: DataTexture;
  private readonly targetGrid = Grid.centred(TARGET_TEX, 0, 0, NORM_EXTENT);
  private readonly targetBytes = new Uint8Array(TARGET_TEX * TARGET_TEX);
  private readonly basis = new Matrix4();

  constructor() {
    const opts = {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
    } as const;
    this.rtA = new WebGLRenderTarget(RT_SIZE, RT_SIZE, opts);
    this.rtB = new WebGLRenderTarget(RT_SIZE, RT_SIZE, opts);
    this.shadowTexture = this.rtA;

    // --- segment pass ---------------------------------------------------
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aA = new InstancedBufferAttribute(new Float32Array(MAX_SEGMENTS * 4), 4);
    this.aB = new InstancedBufferAttribute(new Float32Array(MAX_SEGMENTS * 4), 4);
    this.aC = new InstancedBufferAttribute(new Float32Array(MAX_SEGMENTS * 4), 4);
    for (const a of [this.aA, this.aB, this.aC]) a.setUsage(DynamicDrawUsage);
    geo.setAttribute('aA', this.aA);
    geo.setAttribute('aB', this.aB);
    geo.setAttribute('aC', this.aC);
    geo.instanceCount = 0;
    this.segGeo = geo;
    this.segMat = new ShaderMaterial({
      uniforms: { uS: { value: 2.4 } },
      vertexShader: /* glsl */ `
        attribute vec4 aA;
        attribute vec4 aB;
        attribute vec4 aC;
        uniform float uS;
        varying vec2 vP;
        varying vec4 vA;
        varying vec4 vB;
        varying vec4 vC;
        void main() {
          float pad = aC.w * 1.5;
          vec2 lo = min(aA.xy - aA.z, aB.xy - aB.z) - pad;
          vec2 hi = max(aA.xy + aA.z, aB.xy + aB.z) + pad;
          vec2 p = mix(lo, hi, position.xy);
          vP = p; vA = aA; vB = aB; vC = aC;
          gl_Position = vec4(p * (2.0 / uS), 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vP;
        varying vec4 vA;
        varying vec4 vB;
        varying vec4 vC;
        ${SD_CAPSULE}
        void main() {
          if (vA.z <= 0.0 && vB.z <= 0.0) discard;
          float d = sdUnevenCapsule(vP, vA.xy, vB.xy, max(vA.z, 0.0), max(vB.z, 0.0));
          float cov = clamp(0.5 - d / vC.w, 0.0, 1.0);
          vec2 ab = vB.xy - vA.xy;
          float t = clamp(dot(vP - vA.xy, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
          cov *= mix(1.0, vC.z, smoothstep(0.2, 1.0, t)) * vC.y;
          if (cov <= 0.002) discard;
          gl_FragColor = vC.x < 0.5 ? vec4(cov, 0.0, 0.0, 1.0) : vec4(0.0, cov, 0.0, 1.0);
        }`,
      blending: CustomBlending,
      blendEquation: MaxEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      depthTest: false,
      depthWrite: false,
    });
    const segMesh = new Mesh(geo, this.segMat);
    segMesh.frustumCulled = false;
    this.segScene.add(segMesh);

    // --- blur pass ------------------------------------------------------
    this.blurMat = new ShaderMaterial({
      uniforms: { uTex: { value: null }, uDir: { value: new Vector2() } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        uniform vec2 uDir;
        varying vec2 vUv;
        void main() {
          vec4 s = texture2D(uTex, vUv) * 0.2270270270;
          s += (texture2D(uTex, vUv + uDir * 1.3846153846) + texture2D(uTex, vUv - uDir * 1.3846153846)) * 0.3162162162;
          s += (texture2D(uTex, vUv + uDir * 3.2307692308) + texture2D(uTex, vUv - uDir * 3.2307692308)) * 0.0702702703;
          gl_FragColor = s;
        }`,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.blurMat);
    quad.frustumCulled = false;
    this.blurScene.add(quad);

    // --- target outline texture ----------------------------------------
    this.targetTex = new DataTexture(this.targetBytes, TARGET_TEX, TARGET_TEX, RedFormat, UnsignedByteType);
    this.targetTex.minFilter = LinearFilter;
    this.targetTex.magFilter = LinearFilter;
    this.targetTex.needsUpdate = true;

    // --- wall -----------------------------------------------------------
    this.wallMat = new ShaderMaterial({
      uniforms: {
        uShadow: { value: this.rtA.texture },
        uTarget: { value: this.targetTex },
        uS: { value: 2.4 },
        uPool: { value: new Vector4(-0.05, 0.05, 1.0, 1) }, // centre xy, radius, intensity
        uTX: { value: new Vector4(0, 0, 0.2, 0) }, // target centre xy, scale, angle
        uTMirror: { value: 1 },
        uTVis: { value: 0 },
        uGlow: { value: 0 },
        uTime: { value: 0 },
        uContrast: { value: 1 },
        uFlash: { value: 0 },
        uExtent: { value: NORM_EXTENT },
        uVirtualWall: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform float uS;
        varying vec2 vP;
        void main() {
          vP = (uv - 0.5) * uS;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uShadow;
        uniform sampler2D uTarget;
        uniform float uS;
        uniform vec4 uPool;
        uniform vec4 uTX;
        uniform float uTMirror;
        uniform float uTVis;
        uniform float uGlow;
        uniform float uTime;
        uniform float uContrast;
        uniform float uFlash;
        uniform float uExtent;
        uniform float uVirtualWall;
        varying vec2 vP;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }

        void main() {
          vec2 uv = vP / uS + 0.5;
          vec4 sh = texture2D(uShadow, uv);
          float shadow = clamp(max(sh.r, sh.g), 0.0, 1.0);

          // Candle-like flicker and a soft, slightly uneven pool of light.
          float flick = 0.94 + 0.04 * sin(uTime * 7.3) + 0.03 * sin(uTime * 13.1 + 1.7) + 0.02 * noise(vec2(uTime * 3.0, 0.0));
          float r = length(vP - uPool.xy) / uPool.z;
          float pool = (1.0 - smoothstep(0.5, 1.0, r + 0.05 * (noise(vP * 3.0) - 0.5))) * uPool.w;
          float grain = 0.92 + 0.08 * noise(vP * 90.0);

          // Target outline, mapped into the target's normalised frame.
          vec2 q = (vP - uTX.xy) / uTX.z;
          q.x *= uTMirror;
          float ca = cos(uTX.w), sa = sin(uTX.w);
          q = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
          vec2 tuv = q / uExtent + 0.5;
          float inBounds = step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0);
          float sdf = (texture2D(uTarget, tuv).r - 0.5) * 0.5; // normalised units
          float band = 1.0 - smoothstep(0.010, 0.026, abs(sdf));
          // a soft highlight that travels around the outline while searching
          float shimmer = mix(0.62 + 0.38 * sin(uTime * 2.4 - atan(q.y, q.x) * 2.0), 1.0, smoothstep(0.4, 0.9, uGlow));
          float outline = band * shimmer * uTVis * inBounds;
          float fillHint = (1.0 - smoothstep(-0.02, 0.0, sdf)) * uTVis * inBounds * 0.10;

          vec3 warm = vec3(1.0, 0.80, 0.52);
          float lit = pool * 0.34 * flick * grain;
          float dark = shadow * pool;
          float shadowAlpha = mix(0.72, 0.9, uContrast - 1.0);

          vec3 col = warm;
          float a = lit * (1.0 - dark) + dark * shadowAlpha;
          col = mix(col, vec3(0.03, 0.015, 0.0), clamp(dark * 1.4, 0.0, 1.0));

          // faint warm fill inside the target where the player's shadow isn't yet
          a += fillHint * pool * (1.0 - shadow);
          vec3 gold = mix(vec3(1.0, 0.86, 0.55), vec3(1.0, 0.95, 0.75), uGlow);
          col = mix(col, gold, clamp(outline, 0.0, 1.0));
          a = max(a, outline * (0.45 + 0.45 * uGlow));

          // flash when a creature wakes
          col = mix(col, vec3(1.0, 0.93, 0.7), uFlash * pool);
          a = max(a, uFlash * pool * 0.55);

          if (uVirtualWall > 0.5) {
            // desktop preview: opaque plaster wall, dimly lit outside the pool
            vec3 plaster = vec3(0.16, 0.14, 0.13) * (0.9 + 0.1 * noise(vP * 40.0));
            vec3 base = plaster + warm * lit * 1.6;
            base = mix(base, base * 0.08, clamp(dark * 1.15, 0.0, 1.0));
            base = mix(base, gold, clamp(outline, 0.0, 1.0) * (0.55 + 0.4 * uGlow));
            base += warm * fillHint * pool * (1.0 - shadow) * 0.6;
            base = mix(base, vec3(1.0, 0.93, 0.7), uFlash * pool * 0.5);
            gl_FragColor = vec4(base, 1.0);
            return;
          }
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }`,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.wall = new Mesh(new PlaneGeometry(1, 1), this.wallMat);
    this.wall.renderOrder = 10;
    this.wall.frustumCulled = false;
  }

  /** Places the wall mesh on the stage and sizes the shadow region. */
  placeWall(stage: Stage, size: number): void {
    const R = stage.wallRight;
    const U = stage.wallUp;
    const N = stage.wallNormal;
    this.basis.set(R[0], U[0], N[0], 0, R[1], U[1], N[1], 0, R[2], U[2], N[2], 0, 0, 0, 0, 1);
    this.wall.quaternion.setFromRotationMatrix(this.basis);
    this.wall.position.set(
      stage.wallPoint[0] + N[0] * 0.006,
      stage.wallPoint[1] + N[1] * 0.006,
      stage.wallPoint[2] + N[2] * 0.006,
    );
    this.wall.scale.set(size, size, 1);
    this.wallMat.uniforms.uS.value = size;
    this.segMat.uniforms.uS.value = size;
  }

  /** Uploads a target's outline (signed distance field) for the wall shader. */
  setTarget(target: Target | null): void {
    if (!target) {
      this.wallMat.uniforms.uTVis.value = 0;
      return;
    }
    sdfField(target.segs, target.count, this.targetGrid);
    const d = this.targetGrid.data;
    for (let i = 0; i < d.length; i++) {
      const v = d[i] * 2 + 0.5; // ±0.25 normalised units → 0..1
      this.targetBytes[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    this.targetTex.needsUpdate = true;
  }

  /**
   * Fills the instance buffers. Hand segments go to channel R, creature
   * segments to channel G. `blurPx` is the penumbra half-width in texels.
   */
  draw(
    renderer: WebGLRenderer,
    handSegs: Float32Array,
    handCount: number,
    creatureSegs: Float32Array,
    creatureAlpha: Float32Array,
    creatureCount: number,
    regionSize: number,
    blurPx: number,
  ): void {
    const A = this.aA.array as Float32Array;
    const B = this.aB.array as Float32Array;
    const C = this.aC.array as Float32Array;
    const aa = (regionSize / RT_SIZE) * 1.2;
    let n = 0;
    const put = (segs: Float32Array, i: number, channel: number, opacity: number, fadeB: number) => {
      if (n >= MAX_SEGMENTS) return;
      const o = i * SEG_STRIDE;
      A[n * 4] = segs[o];
      A[n * 4 + 1] = segs[o + 1];
      A[n * 4 + 2] = segs[o + 2];
      A[n * 4 + 3] = 0;
      B[n * 4] = segs[o + 4];
      B[n * 4 + 1] = segs[o + 5];
      B[n * 4 + 2] = segs[o + 6];
      B[n * 4 + 3] = 0;
      C[n * 4] = channel;
      C[n * 4 + 1] = opacity;
      C[n * 4 + 2] = fadeB;
      C[n * 4 + 3] = aa;
      n++;
    };
    // The last segment of each hand is the forearm: fade it towards the elbow.
    for (let i = 0; i < handCount; i++) {
      const isForearm = isForearmIndex(i);
      put(handSegs, i, 0, 1, isForearm ? 0 : 1);
    }
    for (let i = 0; i < creatureCount; i++) put(creatureSegs, i, 1, creatureAlpha[i], 1);
    this.segGeo.instanceCount = n;
    this.aA.needsUpdate = true;
    this.aB.needsUpdate = true;
    this.aC.needsUpdate = true;
    this.aA.clearUpdateRanges();
    this.aB.clearUpdateRanges();
    this.aC.clearUpdateRanges();
    this.aA.addUpdateRange(0, n * 4);
    this.aB.addUpdateRange(0, n * 4);
    this.aC.addUpdateRange(0, n * 4);

    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevAutoClear = renderer.autoClear;
    renderer.xr.enabled = false;
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);

    renderer.setRenderTarget(this.rtA);
    renderer.clear(true, false, false);
    if (n > 0) renderer.render(this.segScene, this.segCamera);

    const px = Math.max(0.5, Math.min(3, blurPx)) / RT_SIZE;
    this.blurMat.uniforms.uTex.value = this.rtA.texture;
    this.blurMat.uniforms.uDir.value.set(px, 0);
    renderer.setRenderTarget(this.rtB);
    renderer.render(this.blurScene, this.segCamera);
    this.blurMat.uniforms.uTex.value = this.rtB.texture;
    this.blurMat.uniforms.uDir.value.set(0, px);
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.blurScene, this.segCamera);

    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = prevXr;
    renderer.autoClear = prevAutoClear;
  }
}

/** Hands are written as whole blocks of BONES_PER_HAND; the last of each is the forearm. */
function isForearmIndex(i: number): boolean {
  return i % BONES_PER_HAND === BONES_PER_HAND - 1;
}
