/**
 * Webcam hands: MediaPipe's hand landmarker turned into the same 25-joint,
 * world-space hands that WebXR hand tracking provides, so the whole game runs
 * on a laptop. The screen plays the wall; the lantern is behind you.
 *
 * MediaPipe gives 21 landmarks in metres (hand-centred, camera axes). WebXR's
 * four finger metacarpal joints have no MediaPipe twin, so they're placed
 * along the wrist→knuckle line where a real tracked hand has them.
 */

import type { HandLandmarker, NormalizedLandmark, Landmark } from '@mediapipe/tasks-vision';
import { J, JOINT_COUNT, REST } from '../core/hand-data.js';
import { state } from './state.js';
import { externalHands } from './theatre.js';

// MediaPipe → WebXR joint mapping. -1 entries are synthesised.
const MP_FOR_XR: number[] = [
  0, // wrist
  1, 2, 3, 4, // thumb: cmc, mcp, ip, tip
  -1, 5, 6, 7, 8, // index
  -1, 9, 10, 11, 12, // middle
  -1, 13, 14, 15, 16, // ring
  -1, 17, 18, 19, 20, // pinky
];
// Where the WebXR metacarpal joint sits on the wrist→knuckle line (from REST).
const MC_FRACTION: Record<number, [number, number]> = {
  [J.INDEX_MC]: [5, 0.38],
  [J.MIDDLE_MC]: [9, 0.36],
  [J.RING_MC]: [13, 0.39],
  [J.PINKY_MC]: [17, 0.44],
};
const REST_PALM = Math.hypot(REST[J.MIDDLE_PP].p[0], REST[J.MIDDLE_PP].p[1], REST[J.MIDDLE_PP].p[2]);

export type WebcamStatus = 'idle' | 'loading' | 'running' | 'denied' | 'error';

export class WebcamHands {
  status: WebcamStatus = 'idle';
  video: HTMLVideoElement | null = null;
  private landmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;
  private raf = 0;
  private readonly smooth = [new Float32Array(JOINT_COUNT * 3), new Float32Array(JOINT_COUNT * 3)];
  private readonly seen = [0, 0];
  onStatus: (s: WebcamStatus, detail?: string) => void = () => {};

  async start(): Promise<void> {
    if (this.status === 'loading' || this.status === 'running') return;
    this.set('loading');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' },
        audio: false,
      });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      this.video = video;

      const base = `${import.meta.env.BASE_URL}mediapipe/`;
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(base.replace(/\/$/, ''));
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}hand_landmarker.task`, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      externalHands.active = true;
      state.handSource = 'webcam';
      this.set('running');
      this.loop();
    } catch (err) {
      const name = (err as { name?: string }).name;
      this.set(name === 'NotAllowedError' ? 'denied' : 'error', String(err));
    }
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    const stream = this.video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    this.video = null;
    this.landmarker?.close();
    this.landmarker = null;
    externalHands.active = false;
    this.set('idle');
  }

  private set(s: WebcamStatus, detail?: string): void {
    this.status = s;
    this.onStatus(s, detail);
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const video = this.video;
    const lm = this.landmarker;
    if (!video || !lm || video.readyState < 2) return;
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;
    const res = lm.detectForVideo(video, performance.now());
    const got = [false, false];
    for (let h = 0; h < res.landmarks.length; h++) {
      // MediaPipe labels assume a mirrored selfie image; we feed the raw
      // camera frame, so its "Left" is the player's right hand.
      const label = res.handedness[h]?.[0]?.categoryName;
      const side = label === 'Left' ? 1 : 0;
      if (got[side]) continue;
      got[side] = true;
      this.writeHand(side, res.landmarks[h], res.worldLandmarks[h], video.videoWidth / Math.max(1, video.videoHeight));
    }
    for (let s = 0; s < 2; s++) {
      if (got[s]) this.seen[s] = 0;
      else if (++this.seen[s] > 6) state.hands[s].tracked = false; // brief dropouts are bridged
    }
  };

  /**
   * Places a detected hand in front of the virtual puppeteer. Image position
   * moves the hand left/right/up/down; apparent size moves it towards the
   * lantern (bigger shadow) or the wall (smaller, sharper shadow).
   */
  private writeHand(side: number, img: NormalizedLandmark[], world: Landmark[], aspect: number): void {
    const H = state.head.position;
    const R = state.head.right;
    const U = state.head.up;
    const F = state.head.forward;
    // image → puppeteer space (camera faces the player: image right = player's left)
    const ix = img[0].x - 0.5;
    const iy = img[0].y - 0.5;
    const palmPx = Math.hypot((img[9].x - img[0].x) * aspect, img[9].y - img[0].y);
    const palmM = Math.hypot(world[9].x - world[0].x, world[9].y - world[0].y, world[9].z - world[0].z) || 0.09;
    const near = Math.max(-0.12, Math.min(0.12, (palmPx / 0.16 - 1) * 0.18)); // >0: closer to camera = nearer the wall
    const px = -ix * 0.62;
    const py = -iy * 0.42 - 0.06;
    const pz = 0.4 + near; // forward distance from the head
    const wx = H[0] + R[0] * px + U[0] * py + F[0] * pz;
    const wy = H[1] + R[1] * px + U[1] * py + F[1] * pz;
    const wz = H[2] + R[2] * px + U[2] * py + F[2] * pz;

    const out = state.hands[side];
    const sm = this.smooth[side];
    const k = out.tracked ? 0.55 : 1; // light smoothing against jitter
    const w0 = world[0];
    const put = (j: number, mx: number, my: number, mz: number) => {
      // camera axes → world: x' = -x (image right is the player's left), y' = -y, z' = z
      const lx = -(mx - w0.x);
      const ly = -(my - w0.y);
      const lz = mz - w0.z;
      const x = wx + R[0] * lx + U[0] * ly - F[0] * lz;
      const y = wy + R[1] * lx + U[1] * ly - F[1] * lz;
      const z = wz + R[2] * lx + U[2] * ly - F[2] * lz;
      sm[j * 3] += (x - sm[j * 3]) * k;
      sm[j * 3 + 1] += (y - sm[j * 3 + 1]) * k;
      sm[j * 3 + 2] += (z - sm[j * 3 + 2]) * k;
    };
    for (let j = 0; j < JOINT_COUNT; j++) {
      const m = MP_FOR_XR[j];
      if (m >= 0) {
        put(j, world[m].x, world[m].y, world[m].z);
      } else {
        const [knuckle, f] = MC_FRACTION[j];
        const a = world[0];
        const b = world[knuckle];
        put(j, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
      }
    }
    out.joints.set(sm);
    const scale = palmM / REST_PALM;
    for (let j = 0; j < JOINT_COUNT; j++) out.radii[j] = REST[j].r * scale;
    out.tracked = true;
  }
}

export const webcam = new WebcamHands();
