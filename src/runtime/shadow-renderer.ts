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
  Vector3,
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
        // Story stage: x night, y dawn, z stars, w moon
        uSky: { value: new Vector4(0, 0, 0, 0) },
        // x rain, y snow, z fireflies, w lightning flash
        uWeather: { value: new Vector4(0, 0, 0, 0) },
        uMoon: { value: new Vector2(-0.82, 0.8) },
        // How much of the moon is lit (it waxes night by night; 1 = full).
        uMoonLit: { value: 1 },
        // Wind: the lantern sways, and every shadow with it (wall metres).
        uSway: { value: new Vector2(0, 0) },
        // Look to choose: the ring filling around what the player is looking at (x, y, radius, progress)…
        uGaze: { value: new Vector4(0, 0, 0, 0) },
        // …and a soft dot where they're looking (x, y, strength).
        uGazeDot: { value: new Vector3(0, 0, 0) },
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
        uniform vec4 uSky;
        uniform vec4 uWeather;
        uniform vec2 uMoon;
        uniform float uMoonLit;
        uniform vec2 uSway;
        uniform vec4 uGaze;
        uniform vec3 uGazeDot;
        varying vec2 vP;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }

        // "Over" compositing of a light layer (colour lc, coverage k) onto (col, a).
        void over(inout vec3 col, inout float a, vec3 lc, float k) {
          k = clamp(k, 0.0, 1.0);
          float na = k + a * (1.0 - k);
          col = (lc * k + col * a * (1.0 - k)) / max(na, 1e-4);
          a = na;
        }

        // Rain as the theatre draws it: thin slanted streaks of shadow, falling.
        float rainField(vec2 p, float t) {
          vec2 q = vec2(p.x + p.y * 0.2, p.y);
          float colw = 0.032;
          float c = floor(q.x / colw);
          float h = hash(vec2(c, 3.7));
          float sp = 2.0 + h * 1.4;
          float y = q.y * 1.4 + t * sp + h * 7.0;
          float f = fract(y);
          float len = 0.12 + 0.08 * h;
          float streak = smoothstep(0.0, 0.02, f) * (1.0 - smoothstep(len * 0.5, len, f));
          float lane = 1.0 - smoothstep(0.06, 0.2, abs(fract(q.x / colw) - 0.5));
          return streak * lane * step(0.5, hash(vec2(c, floor(y))));
        }

        // Snow: soft round flakes drifting down and sideways, two layers deep.
        float snowField(vec2 p, float t) {
          float s = 0.0;
          for (int L = 0; L < 2; L++) {
            float fl = float(L);
            float sc = 6.0 + fl * 5.0;
            vec2 q = p * sc;
            q.y += t * (0.5 + fl * 0.35);
            q.x += sin(q.y * 0.8 + t * 0.7 + fl * 2.0) * 0.3;
            vec2 cell = floor(q);
            vec2 f = fract(q) - 0.5;
            float h = hash(cell + fl * 17.0);
            vec2 o = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
            float r = 0.07 + 0.08 * h;
            s = max(s, (1.0 - smoothstep(r * 0.5, r, length(f - o * 0.55))) * step(0.4, h));
          }
          return s;
        }

        float starField(vec2 p, float t) {
          vec2 q = p * 24.0;
          vec2 cell = floor(q);
          float h = hash(cell);
          if (h < 0.9) return 0.0;
          vec2 o = (vec2(hash(cell + 1.3), hash(cell + 2.9)) - 0.5) * 0.6;
          float d = length(fract(q) - 0.5 - o);
          float tw = 0.55 + 0.45 * sin(t * (1.5 + h * 4.0) + h * 40.0);
          return ((1.0 - smoothstep(0.03, 0.12, d)) + (1.0 - smoothstep(0.05, 0.3, d)) * 0.25) * tw * min(1.0, (h - 0.9) * 16.0);
        }

        float fireflyField(vec2 p, float t) {
          float g = 0.0;
          for (int i = 0; i < 9; i++) {
            float fi = float(i);
            vec2 c = (vec2(noise(vec2(t * 0.12 + fi * 3.1, fi * 1.7)), noise(vec2(fi * 2.3, t * 0.1 + fi * 5.3))) - 0.5) * vec2(2.2, 1.4);
            float blink = 0.5 + 0.5 * sin(t * (1.1 + fi * 0.23) + fi * 2.0);
            vec2 d = p - c;
            float dd = dot(d, d);
            g += (exp(-dd / 0.00025) + exp(-dd / 0.003) * 0.3) * blink;
          }
          return g;
        }

        void main() {
          vec2 uv = (vP - uSway) / uS + 0.5;
          vec4 sh = texture2D(uShadow, uv);
          float shadow = clamp(max(sh.r, sh.g), 0.0, 1.0);

          // Candle-like flicker and a soft, slightly uneven pool of light.
          float flick = 0.94 + 0.04 * sin(uTime * 7.3) + 0.03 * sin(uTime * 13.1 + 1.7) + 0.02 * noise(vec2(uTime * 3.0, 0.0));
          float r = length(vP - uPool.xy - uSway * 0.7) / uPool.z;
          float pool = (1.0 - smoothstep(0.5, 1.0, r + 0.05 * (noise(vP * 3.0) - 0.5))) * uPool.w;
          // High contrast: a brighter, even light; darker, crisper shadows; a bolder outline.
          float hc = clamp(uContrast - 1.0, 0.0, 1.0);
          float grain = mix(0.92 + 0.08 * noise(vP * 90.0), 1.0, hc);

          // Weather falls between the lantern and the wall, so it casts shadows too.
          if (uWeather.x > 0.004) shadow = max(shadow, rainField(vP, uTime) * 0.5 * uWeather.x);
          if (uWeather.y > 0.004) shadow = max(shadow, snowField(vP, uTime) * 0.6 * uWeather.y);

          // Target outline, mapped into the target's normalised frame.
          vec2 q = (vP - uTX.xy) / uTX.z;
          q.x *= uTMirror;
          float ca = cos(uTX.w), sa = sin(uTX.w);
          q = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
          vec2 tuv = q / uExtent + 0.5;
          float inBounds = step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0);
          float sdf = (texture2D(uTarget, tuv).r - 0.5) * 0.5; // normalised units
          float band = 1.0 - smoothstep(mix(0.010, 0.018, hc), mix(0.026, 0.038, hc), abs(sdf));
          // a soft highlight that travels around the outline while searching
          float shimmer = mix(0.62 + 0.38 * sin(uTime * 2.4 - atan(q.y, q.x) * 2.0), 1.0, smoothstep(0.4, 0.9, uGlow));
          float outline = band * shimmer * uTVis * inBounds;
          float fillHint = (1.0 - smoothstep(-0.02, 0.0, sdf)) * uTVis * inBounds * 0.10;

          // Night cools the lantern light; dawn warms it towards rose and gold.
          // (moonlight blue at the edges, the lantern's own warmth kept at the centre)
          vec3 warm = mix(vec3(1.0, 0.80, 0.52), vec3(0.62, 0.72, 1.0), uSky.x * 0.6 * smoothstep(0.15, 0.95, r));
          warm = mix(warm, vec3(1.0, 0.74, 0.62), uSky.y * 0.5);
          float lit = pool * mix(0.34, 0.46, hc) * mix(flick, 1.0, hc) * grain * (1.0 - 0.2 * uSky.x + 0.25 * uSky.y);
          float dark = shadow * pool;
          float shadowAlpha = mix(0.72, 0.97, hc);

          // Lights in the sky above the stage: the moon, stars, fireflies, dawn.
          float md = length(vP - uMoon);
          float moon = (1.0 - smoothstep(0.1, 0.112, md)) * (0.88 + 0.12 * noise((vP - uMoon) * 22.0)) * uSky.w;
          // A waxing moon: the dark disc slides off to the left night by night, leaving the lit side on the right.
          float shadeD = length(vP - uMoon + vec2(0.224 * uMoonLit, 0.0));
          moon *= 1.0 - (1.0 - smoothstep(0.1, 0.112, shadeD)) * 0.9;
          float moonHalo = exp(-md * md / 0.05) * 0.35 * uSky.w * (0.35 + 0.65 * uMoonLit);
          float stars = uSky.z > 0.004 ? starField(vP, uTime) * uSky.z * (1.0 - pool * 0.8) : 0.0;
          float flies = uWeather.z > 0.004 ? fireflyField(vP, uTime) * uWeather.z : 0.0;
          // Sky lights fade out towards the stage's edges, so the plane's square never shows.
          float m = max(abs(vP.x), abs(vP.y)) / (0.5 * uS);
          // broad glows fall off in a circle (a square mask would show its corners)
          float edge = 1.0 - smoothstep(0.5, 0.98, length(vP) / (0.5 * uS));
          moon *= 1.0 - smoothstep(0.93, 1.0, m);
          moonHalo *= edge;
          stars *= 1.0 - smoothstep(0.8, 0.98, m);
          flies *= 1.0 - smoothstep(0.8, 0.98, m);
          float dawnGlow = uSky.y * smoothstep(1.1, -1.3, vP.y) * 0.32 * edge;
          float bolt = uWeather.w * edge;
          vec3 moonCol = vec3(0.93, 0.95, 1.0);
          vec3 flyCol = vec3(0.85, 1.0, 0.45);
          vec3 dawnCol = vec3(1.0, 0.6, 0.42);
          vec3 boltCol = vec3(0.86, 0.9, 1.0);

          // Look to choose: a gold ring fills clockwise from the top while the player looks.
          vec2 gp = vP - uGaze.xy;
          float gd = length(gp);
          float ringBand = (1.0 - smoothstep(0.005, 0.011, abs(gd - uGaze.z))) * step(0.001, uGaze.z);
          float sweep = step(fract(atan(gp.x, gp.y) / 6.2831853 + 1.0), uGaze.w);
          float ring = ringBand * (0.28 + 0.72 * sweep);
          vec2 dp = vP - uGazeDot.xy;
          float gazeDot = (exp(-dot(dp, dp) / 0.00012) * 0.8 + exp(-dot(dp, dp) / 0.0012) * 0.25) * uGazeDot.z;
          vec3 ringCol = vec3(1.0, 0.88, 0.58);

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
            vec3 plaster = vec3(0.16, 0.14, 0.13) * (0.9 + 0.1 * noise(vP * 40.0)) * (1.0 - 0.35 * uSky.x);
            vec3 base = plaster + warm * lit * 1.6;
            base = mix(base, base * 0.08, clamp(dark * 1.15, 0.0, 1.0));
            base = mix(base, gold, clamp(outline, 0.0, 1.0) * (0.55 + 0.4 * uGlow));
            base += warm * fillHint * pool * (1.0 - shadow) * 0.6;
            base = mix(base, vec3(1.0, 0.93, 0.7), uFlash * pool * 0.5);
            base += moonCol * moonHalo * 0.35 + dawnCol * dawnGlow * 0.5 + vec3(1.0, 0.95, 0.85) * stars * 0.8 + flyCol * flies * 0.9;
            base = mix(base, moonCol * 0.92, clamp(moon, 0.0, 1.0));
            base = mix(base, boltCol, bolt * 0.4);
            base = mix(base, ringCol, clamp(ring, 0.0, 1.0));
            base = mix(base, ringCol, clamp(gazeDot, 0.0, 1.0) * 0.8);
            gl_FragColor = vec4(base, 1.0);
            return;
          }
          over(col, a, dawnCol, dawnGlow);
          over(col, a, moonCol, moonHalo * 0.6);
          over(col, a, moonCol, moon);
          over(col, a, vec3(1.0, 0.95, 0.85), stars);
          over(col, a, flyCol, flies);
          over(col, a, boltCol, bolt * 0.42);
          over(col, a, ringCol, ring * 0.9);
          over(col, a, ringCol, gazeDot * 0.7);
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
