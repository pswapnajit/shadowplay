/**
 * Shadowplay — a hands-first shadow-puppet theatre for Meta Quest (WebXR).
 */

import { createSystem, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { CREATURE_BY_ID, CREATURES } from './core/creatures.js';
import { ACCESS_OPTIONS, loadAccess, setAccess } from './runtime/access.js';
import { audio } from './runtime/audio.js';
import { DemoHandsSystem } from './runtime/demo-hands.js';
import { duet, duetTransport, type DuetStatus } from './runtime/duet.js';
import { newCode, normaliseCode } from './net/link.js';
import { loadBook, nightKey, nightNumber, pendingPromise } from './story/book.js';
import { CAST, moonOf } from './story/protocol.js';
import { DirectorSystem } from './runtime/director.js';
import { GameSystem } from './runtime/game.js';
import { state } from './runtime/state.js';
import { setOnLanternLit, ShadowDrawSystem, TheatreSystem } from './runtime/theatre.js';
import { storyEndpoint } from './runtime/story-mode.js';
import { voice } from './runtime/voice.js';
import { webcam } from './runtime/webcam.js';

loadAccess();

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
  // Story mode is the default; `?story=off` plays the classic lessons, and the
  // original director script (the first demo video) records them too.
  game.storyOn = params.get('story') !== 'off' && !(params.has('director') && !params.has('story'));
  if (params.has('director')) {
    world.registerSystem(DirectorSystem, { priority: 85 });
    const director = world.getSystem(DirectorSystem)!;
    director.theatre = theatre;
    director.game = game;
    director.story = params.has('story');
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
      state.audience = true;
      game.restartIntro();
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

  document.getElementById('teller')!.textContent = storyEndpoint()
    ? 'Stories are improvised live by Claude.'
    : 'Every night the Lantern tells a new story.';

  // Read-aloud: shown once the device turns out to have a voice.
  const aloud = document.getElementById('aloud')!;
  const aloudBox = document.getElementById('read-aloud') as HTMLInputElement;
  aloudBox.addEventListener('change', () => voice.set(aloudBox.checked));
  const showAloud = () => {
    aloud.hidden = !voice.available;
    aloudBox.checked = voice.wanted;
  };
  showAloud();
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.addEventListener?.('voiceschanged', showAloud);

  // --- two players: a friend casts on your wall from theirs ------------------
  const duetBox = document.getElementById('duet-box')!;
  const duetCode = document.getElementById('duet-code')!;
  const duetLabel = document.getElementById('duet-label')!;
  const duetStatus = document.getElementById('duet-status')!;
  const duetCopy = document.getElementById('duet-copy') as HTMLButtonElement;
  const duetButton = document.getElementById('duet') as HTMLButtonElement;
  const transport = duetTransport();
  const invite = (code: string) => `${location.origin}${location.pathname}?join=${code}${transport === 'local' ? '&net=local' : ''}`;
  const HOST_TEXT: Record<DuetStatus, string> = {
    off: '',
    opening: 'Opening your theatre…',
    waiting: 'Send your friend the link (or the code). Go in whenever you like: they can join at any time, on a Quest or with a laptop webcam.',
    joined: 'Your friend is here. Their shadows fall in blue, from their own lantern.',
    lost: '',
    error: '',
  };
  const GUEST_TEXT: Record<DuetStatus, string> = {
    off: '',
    opening: 'Joining your friend’s theatre…',
    waiting: '',
    joined: 'You’re in! Enter the theatre (or try with your webcam) and cast: your shadows appear on your friend’s wall, and theirs on yours.',
    lost: 'The theatre has closed: its host has gone.',
    error: '',
  };
  duet.onStatus = (st) => {
    duetBox.hidden = st === 'off';
    duetLabel.textContent = duet.guest ? 'Joining theatre' : 'Your theatre’s code';
    duetCode.textContent = duet.code;
    duetCopy.hidden = duet.guest || st === 'error';
    duetStatus.textContent = st === 'error' ? duet.detail : (duet.guest ? GUEST_TEXT : HOST_TEXT)[st];
    duetButton.hidden = st !== 'off' && st !== 'error';
  };
  const host = async (code = newCode(), tries = 3): Promise<void> => {
    await duet.start('host', code, transport);
    // That code is taken somewhere: pick another.
    if (duet.status === 'error' && /in use/.test(duet.detail) && tries > 1) return host(newCode(), tries - 1);
  };
  duetButton.addEventListener('click', () => {
    audio.start();
    void host();
  });
  duetCopy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(invite(duet.code)).then(() => {
      duetCopy.textContent = 'Link copied';
      setTimeout(() => (duetCopy.textContent = 'Copy invite link'), 2000);
    });
  });
  const joinCode = normaliseCode(params.get('join'));
  const hostCode = normaliseCode(params.get('host'));
  if (joinCode) void duet.start('guest', joinCode, transport);
  else if (hostCode) void host(hostCode, 1);

  // Comfort and access: remembered on this device; none of it is needed to play.
  const access = document.getElementById('access') as HTMLDetailsElement;
  access.querySelector('.opts')!.replaceChildren(
    ...ACCESS_OPTIONS.map((o) => {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = state.settings[o.key];
      box.addEventListener('change', () => setAccess(o.key, box.checked));
      const name = document.createElement('span');
      name.className = 'l';
      name.textContent = o.label;
      const detail = document.createElement('span');
      detail.className = 'd';
      detail.textContent = o.detail;
      label.append(box, name, detail);
      return label;
    }),
  );
  if (ACCESS_OPTIONS.some((o) => state.settings[o.key])) access.open = true;

  // The Book of Shadows: every tale told on this device, newest first.
  const showBook = () => {
    const book = loadBook();
    // Tonight: which night it is, how the moon is growing, and what the Lantern promised.
    const tonight = document.getElementById('tonight')!;
    tonight.hidden = book.length === 0;
    if (book.length) {
      const night = nightNumber(book);
      const moon = moonOf(night);
      const moonText =
        moon.phase === 'full' ? 'the moon is full: old friends come back tonight' : `${moon.toFull} ${moon.toFull === 1 ? 'night' : 'nights'} until the full moon`;
      const promise = pendingPromise(book);
      const told = nightKey(book[book.length - 1].at) === nightKey(Date.now());
      const span = document.createElement('span');
      span.className = 'moon';
      span.textContent = `${'☾'} Night ${night}`;
      tonight.replaceChildren(span, document.createTextNode(` · ${moonText}`));
      if (promise) {
        const q = document.createElement('q');
        q.textContent = promise.text;
        tonight.append(document.createTextNode(' · the Lantern promised:'), q);
      } else if (told && book[book.length - 1].promise) {
        const q = document.createElement('q');
        q.textContent = book[book.length - 1].promise!;
        tonight.append(document.createTextNode(' · come back tomorrow:'), q);
      }
    }
    const el = document.getElementById('book') as HTMLDetailsElement;
    el.hidden = book.length === 0;
    if (!book.length) return;
    el.querySelector('summary')!.textContent = `Your Book of Shadows · ${book.length} ${book.length === 1 ? 'tale' : 'tales'}`;
    const list = el.querySelector('ol')!;
    list.replaceChildren(
      ...book
        .slice()
        .reverse()
        .map((t) => {
          const li = document.createElement('li');
          const title = document.createElement('span');
          title.className = 't';
          title.textContent = t.title;
          const meta = document.createElement('span');
          meta.className = 'm';
          const cast = t.cast.map((c) => CAST[c].name).join(', ');
          meta.textContent = `${new Date(t.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}${cast ? ` · ${cast}` : ''}${t.keepsake ? ` · left a paper ${t.keepsake}` : ''}`;
          li.append(title, document.createTextNode(` ${t.summary}`), meta);
          return li;
        }),
    );
  };
  showBook();

  world.visibilityState.subscribe((v) => {
    state.audience = v !== VisibilityState.NonImmersive || webcam.status === 'running';
    if (v === VisibilityState.Visible) game.restartIntro();
    if (v === VisibilityState.NonImmersive) showBook();
    landing.classList.toggle('hidden', v !== VisibilityState.NonImmersive || webcam.status === 'running');
    if (v === VisibilityState.Visible) {
      audio.start();
      audio.setAmbience(1);
    } else if (v === VisibilityState.NonImmersive) {
      audio.setAmbience(0.4);
    }
  });

  // Debug handle for the dev tools / automated checks.
  (window as unknown as { shadowplay: unknown }).shadowplay = { world, theatre, game, demo, webcam, state, audio, story: game.story, creatures: CREATURE_BY_ID };
});
