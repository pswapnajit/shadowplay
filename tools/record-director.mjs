// Records the director performance from the IWSDK managed browser:
// video via the Chrome DevTools screencast (the whole composited view,
// including the emulator's room), audio via an in-page MediaRecorder on the
// game's own output. Run with:
//   npx @iwsdk/cli browser run tools/record-director.mjs --timeout 300000
// after `xr enter` and a seated headset pose. Output: tools/out/rec/
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export default async function run({ page, frame, cdp, workspaceRoot }) {
  // Segment config: { "name": "A", "from": 0, "until": 52.4 }
  const seg = JSON.parse(readFileSync(`${workspaceRoot}/tools/rec-segment.json`, 'utf8'));
  const out = `${workspaceRoot}/tools/out/rec/${seg.name}`;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(`${out}/frames`, { recursive: true });
  const app = frame ?? page;
  // Let the emulator's "Remote Control Active" indicator fade after setup commands.
  await page.waitForTimeout((seg.settle ?? 0) * 1000);

  // Clean frame: hide the dev chrome (editor toggle, remote-control pill).
  const hideDevChrome = () => {
    // The emulator's toolbar and controller pills live in a shadow root on
    // top of its canvases.
    const xr = document.querySelector('[data-webxr_runtime]');
    if (xr) for (const el of xr.children) if (el.shadowRoot) el.style.display = 'none';
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      const small = r.width < 520 && r.height < 90;
      const t = el.textContent?.trim() ?? '';
      if (small && (t === 'Remote Control Active' || /^Runtime\s*Editor/.test(t))) el.style.visibility = 'hidden';
      const cs = getComputedStyle(el);
      if (cs.boxShadow && cs.boxShadow !== 'none' && cs.boxShadow.includes('inset')) el.style.boxShadow = 'none';
    }
  };
  await page.evaluate(hideDevChrome).catch(() => {});
  await app.evaluate(hideDevChrome).catch(() => {});

  // A trusted click unlocks audio, then start recording the game's sound.
  await page.mouse.click(4, 4);
  await app.evaluate(async () => {
    const a = window.shadowplay.audio;
    a.start();
    if (a.ctx && a.ctx.state !== 'running') await a.ctx.resume();
    a.setAmbience(1);
    const stream = a.captureStream();
    window.__chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    rec.ondataavailable = (e) => window.__chunks.push(e.data);
    rec.start(250);
    window.__rec = rec;
    window.__recT0 = performance.timeOrigin + performance.now();
  });

  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const i = frames.length;
    const file = `f${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(`${out}/frames/${file}`, Buffer.from(data, 'base64'));
    frames.push({ file, ts: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1512, maxHeight: 938, everyNthFrame: 1 });
  const videoT0 = Date.now() / 1000;

  const duration = await app.evaluate(({ from, until }) => {
    window.director.start(from, until);
    return Math.min(until, window.director.duration) - from;
  }, seg);
  await page.waitForTimeout((duration + 1.0) * 1000);

  await cdp.send('Page.stopScreencast');
  const audio = await app.evaluate(async () => {
    const rec = window.__rec;
    await new Promise((r) => {
      rec.onstop = r;
      rec.stop();
    });
    const buf = new Uint8Array(await new Blob(window.__chunks).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), t0: window.__recT0 / 1000 };
  });
  writeFileSync(`${out}/audio.webm`, Buffer.from(audio.b64, 'base64'));
  writeFileSync(`${out}/frames.json`, JSON.stringify({ frames, audioT0: audio.t0, videoT0, duration }, null, 1));
  return { frames: frames.length, duration, fps: frames.length / (duration + 1.0) };
}
