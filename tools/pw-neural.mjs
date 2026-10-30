// Checks the Lantern's own voice end to end on the dev server: a live story
// starts, each line is fetched from /api/voice and played from the lantern.
//   npx @iwsdk/cli browser run tools/pw-neural.mjs --timeout 110000
export default async function run({ page, frame }) {
  const app = frame ?? page;
  await app.evaluate(() => {
    localStorage.removeItem('shadowplay.book.v1');
    localStorage.setItem('shadowplay.v1', JSON.stringify({ collected: ['bird'] }));
    localStorage.removeItem('shadowplay.voice');
  });
  const url = new URL(app.url());
  url.search = '';
  await app.goto(url.toString(), { waitUntil: 'load' });
  await app.waitForFunction(() => window.shadowplay?.game?.phase === 'intro', null, { timeout: 20000 });
  await page.mouse.click(4, 4);
  const log = [];
  log.push(
    await app.evaluate(async () => {
      const sp = window.shadowplay;
      sp.audio.start();
      if (sp.audio.ctx.state !== 'running') await sp.audio.ctx.resume();
      document.getElementById('landing').classList.add('hidden');
      // Watch the voice: when each line starts playing, and for how long.
      const v = await import('/src/runtime/voice.ts').then((m) => m.voice);
      window.__voice = v;
      window.__spoken = [];
      const play = sp.audio.playVoice.bind(sp.audio);
      sp.audio.playVoice = (buf, vol) => (window.__spoken.push({ at: performance.now(), dur: +buf.duration.toFixed(2) }), play(buf, vol));
      sp.demo.perform(sp.creatures.bird);
      return `neural ${v.neural}, on ${v.on}, audio ${sp.audio.ctx.state}`;
    }),
  );
  await app.waitForFunction(() => window.shadowplay.game.phase === 'story', null, { timeout: 20000 });
  await app.evaluate(() => window.shadowplay.demo.perform(null));
  // Let the opening play out in real time until the first ask.
  await app.waitForFunction(() => window.shadowplay.story.phase === 'asking', null, { timeout: 90000 }).catch(() => log.push('no ask within 90 s'));
  log.push(
    await app.evaluate(() => {
      const voiceCalls = performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/voice'));
      return JSON.stringify({
        source: window.shadowplay.story.narrator.source,
        voiceRequests: voiceCalls.length,
        spoken: window.__spoken,
        ask: window.shadowplay.story.prompt,
        stillNeural: window.__voice.neural,
      });
    }),
  );
  return log;
}
