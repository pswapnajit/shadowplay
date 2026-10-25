/**
 * Shadowplay — a hands-first shadow-puppet theatre for Meta Quest (WebXR).
 */

import { createSystem, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { CREATURE_BY_ID, CREATURES } from './core/creatures.js';
import { audio } from './runtime/audio.js';
import { DemoHandsSystem } from './runtime/demo-hands.js';
import { DirectorSystem } from './runtime/director.js';
import { GameSystem } from './runtime/game.js';
import { state } from './runtime/state.js';
import { setOnLanternLit, ShadowDrawSystem, TheatreSystem } from './runtime/theatre.js';
import { webcam } from './runtime/webcam.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.registerSystem(DemoHandsSystem, { priority: 90 });
  world.registerSystem(TheatreSystem, { priority: 100 });
  world.registerSystem(GameSystem, { priority: 200 });
  world.registerSystem(ShadowDrawSystem, { priority: 300 });

  const theatre = world.getSystem(TheatreSystem)!;
  const game = world.getSystem(GameSystem)!;
  const draw = world.getSystem(ShadowDrawSystem)!;
  const demo = world.getSystem(DemoHandsSystem)!;
  draw.theatre = theatre;
  game.theatre = theatre;

  // Desktop preview: a seated eye height looking at the wall. Once the
  // theatre is placed, frame the light pool (slightly above centre so the
  // landing card doesn't cover it).
  world.camera.position.set(0, 1.2, 0);
  world.camera.lookAt(0, 1.2, -1);
  let framed = false;
  world.registerSystem(
    class FrameCamera extends createSystem({}) {
      update(): void {
        const st = state.stage;
        if (!st || this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
          framed = false;
          return;
        }
        if (framed) return;
        // Over the puppeteer's shoulder: hands in the foreground, the shadow
        // theatre beyond — what the player sees in the headset.
        const W = st.wallPoint;
        const H = state.head.position;
        this.world.camera.position.set(H[0] - 0.08, H[1] + 0.16, H[2] + 0.62);
        this.world.camera.lookAt(W[0] + 0.12, W[1] - 0.22, W[2]);
        this.world.camera.fov = 58;
        this.world.camera.updateProjectionMatrix();
        framed = true;
      }
    },
    { priority: 310 },
  );

  const params = new URLSearchParams(location.search);
  if (params.has('director')) {
    world.registerSystem(DirectorSystem, { priority: 85 });
    const director = world.getSystem(DirectorSystem)!;
    director.theatre = theatre;
    director.game = game;
    (window as unknown as { director: unknown }).director = director;
  }
  if (params.has('demo')) {
    const id = params.get('demo') || 'bird';
    demo.perform(CREATURE_BY_ID[id] ?? CREATURES[0]);
  }

  setOnLanternLit(() => audio.lanternLit());
  // Webcam hand tracking runs inside the frame loop so it keeps going in XR.
  world.registerSystem(
    class WebcamTick extends createSystem({}) {
      update(): void {
        webcam.tick();
      }
    },
    { priority: 80 },
  );

  // --- landing page -------------------------------------------------------
  const landing = document.getElementById('landing')!;
  const enter = document.getElementById('enter-xr') as HTMLButtonElement;
  const startAudio = () => audio.start();
  document.addEventListener('pointerdown', startAudio, { once: false });

  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  const check = async () => {
    const ok = !!xr && ((await xr.isSessionSupported('immersive-ar').catch(() => false)) || (await xr.isSessionSupported('immersive-vr').catch(() => false)));
    enter.disabled = !ok;
    enter.textContent = ok ? 'Enter the theatre' : 'Open on a Quest to play in MR';
  };
  void check();
  enter.addEventListener('click', () => {
    audio.start();
    demo.perform(null);
    world.launchXR();
  });

  // --- webcam mode (laptops, and recording the demo without a headset) ----
  const statusEl = document.getElementById('status')!;
  const pip = document.getElementById('pip')!;
  const say = (msg: string, ms = 0) => {
    statusEl.textContent = msg;
    statusEl.style.display = msg ? 'block' : 'none';
    if (ms) setTimeout(() => (statusEl.style.display = 'none'), ms);
  };
  webcam.onStatus = (s, detail) => {
    if (s === 'loading') say('Waking the lantern… (allow camera access)');
    if (s === 'running') {
      say('Hold your hands up between you and the screen', 6000);
      landing.classList.add('hidden');
      if (webcam.video) {
        pip.replaceChildren(webcam.video);
        pip.style.display = 'block';
      }
    }
    if (s === 'denied') say('Camera access was blocked. Allow it in the address bar to play with your webcam.');
    if (s === 'error') {
      say('Could not start the webcam hand tracker.');
      console.warn(detail);
    }
  };
  document.getElementById('webcam')!.addEventListener('click', () => {
    audio.start();
    audio.setAmbience(0.9);
    demo.perform(null);
    void webcam.start();
  });

  world.visibilityState.subscribe((v) => {
    landing.classList.toggle('hidden', v !== VisibilityState.NonImmersive || webcam.status === 'running');
    if (v === VisibilityState.Visible) {
      audio.start();
      audio.setAmbience(1);
    } else if (v === VisibilityState.NonImmersive) {
      audio.setAmbience(0.4);
    }
  });

  // Debug handle for the dev tools / automated checks.
  (window as unknown as { shadowplay: unknown }).shadowplay = { world, theatre, game, demo, webcam, state, audio };
});
