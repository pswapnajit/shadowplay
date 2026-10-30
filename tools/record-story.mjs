// Records the story director (`?director&story`) in segments: each run records
// up to `seconds` of the show, then freezes the game (state.frozen) so the next
// run continues exactly where this one stopped. Video via the DevTools
// screencast, audio via an in-page MediaRecorder, plus a timestamped log of the
// story (lines, cues, asks) for captions and the video description.
//   echo '{"name":"S1","first":true,"seconds":95}' > tools/rec-segment.json
//   npx @iwsdk/cli browser run tools/record-story.mjs --timeout 110000
// Output: tools/out/rec/<name>/ (frames/, frames.json, audio.webm, story.json)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export default async function run({ page, frame, cdp, workspaceRoot }) {
  const seg = JSON.parse(readFileSync(`${workspaceRoot}/tools/rec-segment.json`, 'utf8'));
  const out = `${workspaceRoot}/tools/out/rec/${seg.name}`;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(`${out}/frames`, { recursive: true });
  const app = frame ?? page;
  await page.waitForTimeout((seg.settle ?? 0) * 1000);

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

  await page.mouse.click(4, 4);
  await app.evaluate(async (first) => {
    const sp = window.shadowplay;
    const a = sp.audio;
    a.start();
    if (a.ctx && a.ctx.state !== 'running') await a.ctx.resume();
    a.setAmbience(1);
    const now = () => performance.timeOrigin + performance.now();
    if (first || !window.__storyLog) {
      // A timestamped transcript of the performance.
      window.__storyLog = [];
      const st = sp.story;
      const speak = st.panel.speak.bind(st.panel);
      st.panel.speak = (text, voiced) => (window.__storyLog.push({ t: now(), say: text }), speak(text, voiced));
      const cue = st.fx.cue.bind(st.fx);
      st.fx.cue = (c) => (window.__storyLog.push({ t: now(), cue: c }), cue(c));
      let last = '';
      setInterval(() => {
        const key = `${sp.game.phase}/${st.phase}/${st.ask}`;
        if (key === last || sp.state.frozen) return;
        last = key;
        window.__storyLog.push({ t: now(), phase: sp.game.phase, story: st.phase, ask: st.ask, prompt: st.prompt, cast: st.cast.join(','), title: st.title, source: st.narrator?.source, latency: st.narrator?.latency.join(',') });
      }, 100);
    }
    const stream = a.captureStream();
    window.__chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    rec.ondataavailable = (e) => window.__chunks.push(e.data);
    rec.start(250);
    window.__rec = rec;
    window.__recT0 = now();
  }, !!seg.first);

  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(`${out}/frames/${file}`, Buffer.from(data, 'base64'));
    frames.push({ file, ts: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1512, maxHeight: 938, everyNthFrame: 1 });
  await page.waitForTimeout(300); // a few frames of the frozen state, so the cut is seamless

  const t0 = await app.evaluate((first) => {
    if (first) window.director.start();
    window.shadowplay.state.frozen = false;
    return performance.timeOrigin + performance.now();
  }, !!seg.first);

  // Record until the time is up, or the story is over and the curtain has fallen.
  const deadline = Date.now() + (seg.seconds ?? 95) * 1000;
  let doneAt = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    const over = await app.evaluate(() => window.shadowplay.game.phase === 'free' && window.shadowplay.story.phase === 'off' && (window.shadowplay.story.cast.length > 0 || window.shadowplay.story.title !== ''));
    if (over && !doneAt) doneAt = Date.now();
    if (doneAt && Date.now() - doneAt > (seg.tail ?? 7000)) break;
  }
  const t1 = await app.evaluate(() => {
    window.shadowplay.state.frozen = true;
    return performance.timeOrigin + performance.now();
  });
  await page.waitForTimeout(250);
  await cdp.send('Page.stopScreencast');

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
  const story = result.log.filter((e) => e.t >= t0 - 50 && e.t <= t1 + 50).map((e) => ({ ...e, t: +((e.t - t0) / 1000).toFixed(2) }));
  writeFileSync(`${out}/story.json`, JSON.stringify(story, null, 1));
  const ended = await app.evaluate(() => window.shadowplay.game.phase === 'free' && window.shadowplay.story.phase === 'off');
  return { frames: frames.length, seconds: +((t1 - t0) / 1000).toFixed(1), ended, lines: story.filter((e) => e.say).length };
}
