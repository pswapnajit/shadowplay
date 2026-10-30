// Plays the start of a live story on a deployed copy of the game (in a fresh
// tab of the managed browser), answering asks with scripted hands.
//   npx @iwsdk/cli browser run tools/pw-public.mjs --timeout 110000
// Options in tools/pw-public.json: { "url": "https://pswapnajit.github.io/shadowplay/?voice=off", "asks": 2 }
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

export default async function run({ page, workspaceRoot }) {
  const cfgPath = `${workspaceRoot}/tools/pw-public.json`;
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
  const url = cfg.url ?? 'https://pswapnajit.github.io/shadowplay/?voice=off';
  const out = `${workspaceRoot}/tools/out/public`;
  mkdirSync(out, { recursive: true });
  const tab = await page.context().newPage();
  await tab.setViewportSize({ width: 1280, height: 800 });
  await tab.goto(url, { waitUntil: 'load' });
  await tab.evaluate(() => {
    localStorage.removeItem('shadowplay.book.v1');
    localStorage.setItem('shadowplay.v1', JSON.stringify({ collected: ['bird'] }));
  });
  await tab.reload({ waitUntil: 'load' });
  await tab.waitForFunction(() => window.shadowplay?.game?.phase === 'intro', null, { timeout: 30000 });
  const log = [`teller: ${await tab.evaluate(() => document.getElementById('teller').textContent)}`];
  await tab.evaluate(() => {
    document.getElementById('landing').classList.add('hidden');
    window.shadowplay.demo.perform(window.shadowplay.creatures.bird);
  });
  await tab.waitForFunction(() => window.shadowplay.game.phase === 'story', null, { timeout: 20000 });
  await tab.evaluate(() => window.shadowplay.demo.perform(null));
  let asks = 0;
  const t0 = Date.now();
  while (asks < (cfg.asks ?? 2) && Date.now() - t0 < 80000) {
    const s = await tab.evaluate(() => ({ phase: window.shadowplay.story.phase, ask: window.shadowplay.story.ask, prompt: window.shadowplay.story.prompt }));
    if (s.phase === 'telling') await tab.evaluate(() => window.shadowplay.story.panel.finish());
    if (s.phase === 'asking') {
      asks++;
      log.push(`ask ${s.ask}: ${s.prompt}`);
      if (asks === 1) await tab.screenshot({ path: `${out}/ask.png` });
      await tab.evaluate((ask) => window.shadowplay.demo.perform(window.shadowplay.creatures[ask === 'any' ? 'bird' : ask]), s.ask);
      await tab.waitForFunction(() => window.shadowplay.story.phase !== 'asking', null, { timeout: 15000 }).catch(() => log.push('not answered'));
      await tab.evaluate(() => window.shadowplay.demo.perform(null));
    }
    await tab.waitForTimeout(200);
  }
  log.push(
    await tab.evaluate(() => {
      const n = window.shadowplay.story.narrator;
      const said = n.events.length;
      return `source ${n.source}; first-step latency ms ${n.latency.join(', ')}; error ${n.lastError || 'none'}; events ${said}`;
    }),
  );
  await tab.close();
  return log;
}
