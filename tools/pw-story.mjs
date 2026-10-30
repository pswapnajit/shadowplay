// End-to-end story check in the IWSDK managed browser (desktop view, scripted hands).
// Plays a whole story: answers every ask with the requested creature (or the
// Chatterbird for "any"), fast-forwards the narration, and screenshots key moments.
//   npx @iwsdk/cli browser run tools/pw-story.mjs --timeout 110000
// Options in tools/pw-story.json: { "query": "?narrator=offline", "fresh": true, "shots": true, "realtime": false }
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export default async function run({ page, frame, workspaceRoot }) {
  const cfgPath = `${workspaceRoot}/tools/pw-story.json`;
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
  const app = frame ?? page;
  const outDir = `${workspaceRoot}/tools/out/story`;
  mkdirSync(outDir, { recursive: true });
  const log = [];
  const shot = async (name) => {
    if (cfg.shots === false) return;
    const el = frame ? await frame.frameElement() : null;
    const path = `${outDir}/${name}.png`;
    if (el) await el.screenshot({ path });
    else await page.screenshot({ path });
    log.push(`shot ${name}`);
  };

  // "prep" only loads the page (then enter XR from the CLI); "run" plays a story on the loaded page.
  if (cfg.step !== 'run') {
    const url = new URL(app.url());
    url.search = cfg.query ?? '?narrator=offline&voice=off';
    await app.evaluate((fresh) => {
      localStorage.removeItem('shadowplay.book.v1');
      localStorage.setItem('shadowplay.v1', JSON.stringify({ collected: fresh ? ['bird'] : ['bird', 'rabbit', 'dog', 'fox'] }));
    }, cfg.fresh ?? true);
    await app.goto(url.toString(), { waitUntil: 'load' });
    await app.waitForFunction(() => window.shadowplay?.game?.phase === 'intro', null, { timeout: 20000 }).catch(() => {});
    if (cfg.step === 'prep') return ['loaded'];
  }
  await app.waitForFunction(() => window.shadowplay?.game?.phase === 'intro', null, { timeout: 20000 }).catch(() => {});
  // The desktop landing card would cover the wall in screenshots.
  await app.evaluate(() => document.getElementById('landing')?.classList.add('hidden'));
  // Hands into the light: the intro moves on to the story.
  await app.evaluate(() => window.shadowplay.demo.perform(window.shadowplay.creatures.bird));
  await app.waitForFunction(() => window.shadowplay.game.phase === 'story', null, { timeout: 15000 });
  await app.evaluate(() => window.shadowplay.demo.perform(null));
  log.push('story started');

  const t0 = Date.now();
  let asks = 0;
  let shots = 0;
  let lastSay = '';
  while (Date.now() - t0 < (cfg.budgetMs ?? 95000)) {
    const s = await app.evaluate(() => {
      const st = window.shadowplay.story;
      const n = st.narrator;
      return {
        game: window.shadowplay.game.phase,
        phase: st.phase,
        ask: st.ask,
        prompt: st.prompt,
        step: st.step ? JSON.stringify(st.step) : null,
        source: n?.source,
        queued: n?.queue.length,
        busy: n?.busy,
        cues: st.fx.history.join(','),
        cast: st.cast.join(','),
        title: st.title,
        latency: n?.latency.join(','),
        error: n?.lastError,
      };
    });
    if (s.step && s.step !== lastSay && s.step.startsWith('{"say"')) {
      lastSay = s.step;
      log.push(`say ${JSON.parse(s.step).say}`);
      if (shots < 2) await shot(`line${++shots}`);
    }
    if (s.phase === 'telling' && !cfg.realtime) await app.evaluate(() => window.shadowplay.story.panel.finish());
    if (s.phase === 'asking') {
      asks++;
      log.push(`ask ${s.ask}: "${s.prompt}" (cues so far: ${s.cues})`);
      if (asks === 1 || s.ask !== 'any') await page.waitForTimeout(600);
      if (asks <= 2) await shot(`ask${asks}`);
      await app.evaluate((ask) => {
        const sp = window.shadowplay;
        sp.demo.perform(sp.creatures[ask === 'any' ? 'bird' : ask]);
      }, s.ask);
      await app.waitForFunction(() => window.shadowplay.story.phase !== 'asking', null, { timeout: 15000 }).catch(() => log.push('ask not answered in 15 s'));
      await page.waitForTimeout(400);
      if (asks === 1) await shot('wake');
      await app.evaluate(() => window.shadowplay.demo.perform(null));
      continue;
    }
    if (s.phase === 'ending') {
      log.push(`end "${s.title}" cast ${s.cast} cues ${s.cues} source ${s.source} latency ${s.latency} ${s.error ? `error ${s.error}` : ''}`);
      await page.waitForTimeout(2500);
      await shot('ending');
      await app.waitForFunction(() => window.shadowplay.game.phase === 'free', null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(3500);
      await shot('after');
      break;
    }
    await page.waitForTimeout(250);
  }
  const book = await app.evaluate(() => localStorage.getItem('shadowplay.book.v1'));
  log.push(`book ${book}`);
  writeFileSync(`${outDir}/log.json`, JSON.stringify(log, null, 1));
  return log;
}
