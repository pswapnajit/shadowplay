// Runs the story director (`?director&story`) on the loaded page and screenshots it.
// Narration is fast-forwarded unless tools/pw-story.json has "realtime": true.
//   npx @iwsdk/cli browser run tools/pw-director-story.mjs --timeout 110000
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export default async function run({ page, frame, workspaceRoot }) {
  const cfgPath = `${workspaceRoot}/tools/pw-story.json`;
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
  const app = frame ?? page;
  const out = `${workspaceRoot}/tools/out/director-story`;
  mkdirSync(out, { recursive: true });
  const el = frame ? await frame.frameElement() : null;
  const shot = (name) => (el ? el.screenshot({ path: `${out}/${name}.png` }) : page.screenshot({ path: `${out}/${name}.png` }));
  const log = [];
  await app.evaluate(() => window.director.start());
  const t0 = Date.now();
  let last = '';
  let n = 0;
  while (Date.now() - t0 < 100000) {
    const s = await app.evaluate(() => {
      const g = window.shadowplay.game;
      const st = window.shadowplay.story;
      return { phase: g.phase, sp: st.phase, ask: st.ask, beat: window.director.beat, holding: window.director.holding, cast: st.cast.join(','), title: st.title };
    });
    const key = `${s.phase}/${s.sp}/${s.ask}/${s.beat}/${s.holding}`;
    if (key !== last) {
      last = key;
      log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${key}`);
      if (s.beat === 'hold' || (s.sp === 'asking' && s.beat === 'shape') || s.sp === 'ending') await shot(`${String(++n).padStart(2, '0')}-${s.phase}-${s.sp}-${s.holding ?? s.ask}`);
    }
    if (s.phase === 'free' && s.sp === 'off' && Date.now() - t0 > 20000) break;
    if (s.sp === 'telling' && !cfg.realtime) await app.evaluate(() => window.shadowplay.story.panel.finish());
    await page.waitForTimeout(200);
  }
  writeFileSync(`${out}/log.json`, JSON.stringify(log, null, 1));
  return log;
}
