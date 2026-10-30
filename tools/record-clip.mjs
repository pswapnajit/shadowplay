// Records one short clip for the demo video (the main story is recorded with
// tools/record-story.mjs). Same capture as the story: DevTools screencast for
// video, an in-page MediaRecorder for the game's sound, and a timestamped log
// of the Lantern's lines for subtitles and the voice.
//
// Scenarios (tools/rec-clip.json {"name", "scenario", "seconds"}):
//   "night": a returning player, the next night. The page must be loaded with
//            ?look&voice=silent, the Book of Shadows seeded (tools/seed-night.mjs)
//            and XR entered with no hands. The Lantern opens (the grown moon, the
//            keepsakes, last night's promise) and the player answers by looking.
//   "duet":  the page is loaded with ?host=CODE&net=local&voice=silent and in XR;
//            a second tab joins (?join=CODE) and its shadows answer the asks.
//            The friend's tab is recorded too (<name>-guest/).
// Output: tools/out/rec/<name>/ (frames/, frames.json, audio.webm, story.json)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const SHELF_H = { wolf: 0.34, fox: 0.24, deer: 0.48, bird: 0.2, rabbit: 0.3, dog: 0.3, swan: 0.32, crocodile: 0.12, butterfly: 0.15 };

export default async function run({ page, frame, cdp, workspaceRoot }) {
  const cfg = JSON.parse(readFileSync(`${workspaceRoot}/tools/rec-clip.json`, 'utf8'));
  const out = `${workspaceRoot}/tools/out/rec/${cfg.name}`;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(`${out}/frames`, { recursive: true });
  const app = frame ?? page;
  const log = [];

  // "prep": seed this browser's theatre for the scenario and load the page (then enter XR from the CLI).
  if (cfg.step === 'prep') {
    await app.evaluate((scenario) => {
      localStorage.removeItem('shadowplay.access.v1');
      if (scenario !== 'night') return;
      // A returning player: the tale just recorded becomes last night's (its promise still to keep),
      // with a few earlier nights and their keepsakes before it.
      const DAY = 86_400_000;
      const now = Date.now();
      const book = JSON.parse(localStorage.getItem('shadowplay.book.v1') ?? '[]');
      const last = book[book.length - 1];
      const older = [
        { title: 'The Rabbit Goes to the Sea', summary: 'A rabbit set out to see the sea before morning.', cast: ['rabbit', 'bird'], at: now - 6 * DAY, by: 'understudy', keepsake: 'shell' },
        { title: 'The Owl Who Hid', summary: 'A shy owl hid in the old oak until the fox found her.', cast: ['fox', 'bird'], at: now - 4 * DAY, by: 'understudy', keepsake: 'feather' },
        { title: 'The Dog and the Small Sad Sound', summary: 'A dog followed a sad sound to a lonely windmill.', cast: ['dog', 'wolf'], at: now - 3 * DAY, by: 'understudy', keepsake: 'bell' },
        { title: 'The Fox and the Fallen Star', summary: 'A fox carried a fallen star back up the hill.', cast: ['fox', 'rabbit'], at: now - 2 * DAY, by: 'understudy', keepsake: 'star' },
      ];
      const seeded = last ? [...older, { ...last, at: now - DAY }] : older;
      localStorage.setItem('shadowplay.book.v1', JSON.stringify(seeded));
      const save = JSON.parse(localStorage.getItem('shadowplay.v1') ?? '{"collected":[]}');
      save.collected = [...new Set([...(save.collected ?? []), 'bird', 'rabbit', 'fox', 'dog'])];
      localStorage.setItem('shadowplay.v1', JSON.stringify(save));
    }, cfg.scenario);
    const url = new URL(app.url());
    url.search = cfg.query ?? (cfg.scenario === 'duet' ? `?host=${cfg.code ?? 'BCDF'}&net=local&voice=silent` : '?look&voice=silent');
    await app.goto(url.toString(), { waitUntil: 'load' });
    await app.waitForFunction(() => window.shadowplay?.game?.phase === 'intro', null, { timeout: 20000 }).catch(() => {});
    // Hold the show until the recording starts (entering XR from the CLI takes a while).
    await app.evaluate(() => {
      window.shadowplay.state.frozen = true;
    });
    return ['loaded', url.search, await app.evaluate(() => document.getElementById('tonight')?.textContent ?? '')];
  }

  // Clean frame: hide the emulator's toolbar, pills and remote-control badge.
  const hideDevChrome = () => {
    const xr = document.querySelector('[data-webxr_runtime]');
    if (xr) for (const el of xr.children) if (el.shadowRoot) el.style.display = 'none';
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      const t = el.textContent?.trim() ?? '';
      if (r.width < 520 && r.height < 90 && (t === 'Remote Control Active' || /^Runtime\s*Editor/.test(t))) el.style.visibility = 'hidden';
    }
  };
  await page.evaluate(hideDevChrome).catch(() => {});
  await app.evaluate(hideDevChrome).catch(() => {});

  // The friend's tab (duet): joins before the recording starts.
  let guest = null;
  let guestCdp = null;
  if (cfg.scenario === 'duet') {
    guest = await page.context().newPage();
    await guest.setViewportSize({ width: 756, height: 425 });
    const join = new URL(app.url());
    join.search = `?join=${cfg.code ?? 'BCDF'}&net=local&voice=off`;
    await guest.goto(join.toString(), { waitUntil: 'load' });
    await guest.waitForFunction(() => window.shadowplay?.game, null, { timeout: 20000 });
    await guest.waitForFunction(() => document.getElementById('duet-status')?.textContent.startsWith('You’re in'), null, { timeout: 20000 });
    await guest.evaluate(() => {
      document.getElementById('landing').classList.add('hidden');
      window.shadowplay.audio.setMuted(true);
    });
    log.push('friend joined');
  }

  await page.mouse.click(4, 4);
  await app.evaluate(async () => {
    const sp = window.shadowplay;
    const a = sp.audio;
    a.start();
    if (a.ctx && a.ctx.state !== 'running') await a.ctx.resume();
    a.setAmbience(1);
    const now = () => performance.timeOrigin + performance.now();
    window.__storyLog = [];
    const st = sp.story;
    const speak = st.panel.speak.bind(st.panel);
    st.panel.speak = (text, voiced) => (window.__storyLog.push({ t: now(), say: text }), speak(text, voiced));
    const cue = st.fx.cue.bind(st.fx);
    st.fx.cue = (c) => (window.__storyLog.push({ t: now(), cue: c }), cue(c));
    let last = '';
    setInterval(() => {
      const key = `${sp.game.phase}/${st.phase}/${st.ask}`;
      if (key === last) return;
      last = key;
      window.__storyLog.push({ t: now(), phase: sp.game.phase, story: st.phase, ask: st.ask, prompt: st.prompt, cast: st.cast.join(','), title: st.title, source: st.narrator?.source });
    }, 100);
    const stream = a.captureStream();
    window.__chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    rec.ondataavailable = (e) => window.__chunks.push(e.data);
    rec.start(250);
    window.__rec = rec;
    window.__recT0 = now();
  });

  const screencast = async (session, dir) => {
    mkdirSync(`${dir}/frames`, { recursive: true });
    const frames = [];
    session.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
      const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
      writeFileSync(`${dir}/frames/${file}`, Buffer.from(data, 'base64'));
      frames.push({ file, ts: metadata.timestamp });
      await session.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await session.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1512, maxHeight: 938, everyNthFrame: 1 });
    return frames;
  };
  const frames = await screencast(cdp, out);
  let guestFrames = null;
  if (guest) {
    rmSync(`${out}-guest`, { recursive: true, force: true });
    guestCdp = await page.context().newCDPSession(guest);
    guestFrames = await screencast(guestCdp, `${out}-guest`);
  }
  await page.waitForTimeout(300);
  // Curtain up: the show was held since the page loaded, and now begins (the lantern's entrance included).
  const t0 = await app.evaluate(() => {
    window.shadowplay.theatre.restartShow();
    window.shadowplay.state.frozen = false;
    return performance.timeOrigin + performance.now();
  });

  // Points the headset at wall point (x, y), like a seated player turning their head.
  const aim = (x, y) =>
    app.evaluate(
      ([x, y]) => {
        const st = window.shadowplay.state.stage;
        if (!st) return; // the wall isn't placed yet
        const H = window.shadowplay.state.head.position;
        const d = [0, 1, 2].map((i) => st.wallPoint[i] + st.wallRight[i] * x + st.wallUp[i] * y - H[i]);
        const len = Math.hypot(...d);
        const yaw = Math.atan2(-d[0] / len, -d[2] / len);
        const pitch = Math.asin(d[1] / len);
        const [cy, sy, cp, sp] = [Math.cos(yaw / 2), Math.sin(yaw / 2), Math.cos(pitch / 2), Math.sin(pitch / 2)];
        const q = { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
        // Queued through the emulator's remote control: that switches the headset to programmatic
        // control (otherwise the emulator's own UI re-applies its pose every frame).
        const dev = window.IWER_DEVICE;
        if (dev.remote?.enqueueDiscrete) void dev.remote.enqueueDiscrete('set_transform', { device: 'headset', orientation: q });
        else dev.quaternion.set(q.x, q.y, q.z, q.w);
      },
      [x, y],
    );
  // Turns the head smoothly from where it looks now to (x, y) over `ms`.
  const glance = async (from, to, ms = 900) => {
    const steps = Math.max(1, Math.round(ms / 50));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      await aim(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e);
      await page.waitForTimeout(50);
    }
  };

  const deadline = Date.now() + (cfg.seconds ?? 45) * 1000;
  if (cfg.scenario === 'night') {
    // Looking at the middle of the wall while the Lantern opens.
    const centre = [0, 0.12];
    await app.waitForFunction(() => window.shadowplay.state.stage, null, { timeout: 15000 });
    await aim(...centre);
    let answered = 0;
    while (Date.now() < deadline && answered < (cfg.asks ?? 1)) {
      const s = await app.evaluate(() => {
        const g = window.shadowplay.game;
        const st = window.shadowplay.story;
        const shelf = g.living.filter((l) => l.mode === 'home' && !l.visitor).map((l) => ({ id: l.def.id, x: l.x, y: l.y + g.shelfLift, s: l.s }));
        return { phase: st.phase, ask: st.ask, askT: st.askT, outline: [g.ox, g.oy], shelf };
      });
      // (once the shelf has risen into the light for choosing)
      if (s.phase === 'asking' && s.askT > 2.4) {
        // Answer by looking: the outline if one is asked for, else a friend on the shelf.
        let to;
        if (s.ask !== 'any') to = s.outline;
        else {
          const pick = s.shelf.find((l) => l.id === (cfg.pick ?? 'fox')) ?? s.shelf[0];
          to = [pick.x, pick.y + (SHELF_H[pick.id] * pick.s) / 2];
        }
        await glance(centre, to);
        await app.waitForFunction(() => window.shadowplay.story.phase !== 'asking', null, { timeout: 8000 }).catch(() => log.push('look did not answer'));
        answered++;
        log.push(`answered ${s.ask} by looking`);
        await glance(to, centre, 1200);
      }
      await page.waitForTimeout(150);
    }
    // a few seconds of what follows
    const tail = Math.min(deadline, Date.now() + (cfg.tail ?? 6000));
    while (Date.now() < tail) await page.waitForTimeout(200);
  } else if (cfg.scenario === 'duet') {
    // The host raises a hand: the show opens for two.
    await app.evaluate(() => window.shadowplay.demo.perform(window.shadowplay.creatures.bird));
    await app.waitForFunction(() => window.shadowplay.game.phase === 'story', null, { timeout: 20000 }).catch(() => log.push('no story'));
    await app.evaluate(() => window.shadowplay.demo.perform(null));
    let answered = 0;
    const answers = cfg.answers ?? ['fox', 'rabbit'];
    while (Date.now() < deadline && answered < answers.length) {
      const s = await app.evaluate(() => ({ phase: window.shadowplay.story.phase, ask: window.shadowplay.story.ask, askT: window.shadowplay.story.askT }));
      if (s.phase === 'asking' && s.askT > 1.0) {
        const make = s.ask === 'any' ? answers[answered] : s.ask;
        await guest.evaluate((id) => window.shadowplay.demo.perform(window.shadowplay.creatures[id]), make);
        await app.waitForFunction(() => window.shadowplay.story.phase !== 'asking', null, { timeout: 15000 }).catch(() => log.push('the friend did not answer'));
        answered++;
        log.push(`friend answered ${s.ask} with ${make}`);
        await page.waitForTimeout(1500);
        await guest.evaluate(() => window.shadowplay.demo.perform(null));
      }
      await page.waitForTimeout(150);
    }
    const tail = Math.min(deadline, Date.now() + (cfg.tail ?? 6000));
    while (Date.now() < tail) await page.waitForTimeout(200);
  }

  const t1 = await app.evaluate(() => performance.timeOrigin + performance.now());
  await page.waitForTimeout(250);
  await cdp.send('Page.stopScreencast');
  if (guestCdp) await guestCdp.send('Page.stopScreencast');

  const result = await app.evaluate(async () => {
    const rec = window.__rec;
    await new Promise((r) => {
      rec.onstop = r;
      rec.stop();
    });
    const buf = new Uint8Array(await new Blob(window.__chunks).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), audioT0: window.__recT0, log: window.__storyLog };
  });
  writeFileSync(`${out}/audio.webm`, Buffer.from(result.b64, 'base64'));
  writeFileSync(`${out}/frames.json`, JSON.stringify({ frames, audioT0: result.audioT0 / 1000, liveT0: t0 / 1000, liveT1: t1 / 1000 }, null, 1));
  if (guestFrames) writeFileSync(`${out}-guest/frames.json`, JSON.stringify({ frames: guestFrames, liveT0: t0 / 1000, liveT1: t1 / 1000 }, null, 1));
  const story = result.log.filter((e) => e.t >= t0 - 50 && e.t <= t1 + 50).map((e) => ({ ...e, t: +((e.t - t0) / 1000).toFixed(2) }));
  writeFileSync(`${out}/story.json`, JSON.stringify(story, null, 1));
  if (guest) await guest.close();
  return { log, frames: frames.length, guestFrames: guestFrames?.length ?? 0, seconds: +((t1 - t0) / 1000).toFixed(1), lines: story.filter((e) => e.say).map((e) => e.say) };
}
