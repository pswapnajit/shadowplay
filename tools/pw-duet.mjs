// Two players, one story: the managed page hosts a theatre, a second tab joins
// it with the room code (tabs are linked by BroadcastChannel, ?net=local), and
// the friend's shadows answer the Lantern's asks.
//   npx @iwsdk/cli browser run tools/pw-duet.mjs --timeout 110000
// Options in tools/pw-duet.json: { "narrator": "offline" | "live", "realtime": false }
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export default async function run({ page, frame, workspaceRoot }) {
  const cfgPath = `${workspaceRoot}/tools/pw-duet.json`;
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
  const app = frame ?? page;
  const out = `${workspaceRoot}/tools/out/duet`;
  mkdirSync(out, { recursive: true });
  const el = frame ? await frame.frameElement() : null;
  const hostShot = (name) => (el ? el.screenshot({ path: `${out}/${name}.png` }) : page.screenshot({ path: `${out}/${name}.png` }));
  const log = [];
  const code = 'BCDF';
  const narrator = cfg.narrator === 'live' ? '' : '&narrator=offline';

  await app.evaluate(() => {
    localStorage.removeItem('shadowplay.book.v1');
    localStorage.setItem('shadowplay.v1', JSON.stringify({ collected: ['bird', 'rabbit', 'fox'] }));
  });
  const base = new URL(app.url());
  base.search = `?host=${code}&net=local&voice=off${narrator}`;
  await app.goto(base.toString(), { waitUntil: 'load' });
  await app.waitForFunction(() => window.shadowplay?.game?.phase === 'intro', null, { timeout: 20000 });

  // The friend opens the invite link in another tab.
  const guest = await page.context().newPage();
  await guest.setViewportSize({ width: 756, height: 469 });
  const join = new URL(base.toString());
  join.search = `?join=${code}&net=local&voice=off`;
  await guest.goto(join.toString(), { waitUntil: 'load' });
  await guest.waitForFunction(() => window.shadowplay?.game, null, { timeout: 20000 });
  await guest.waitForFunction(() => document.getElementById('duet-status')?.textContent.startsWith('You’re in'), null, { timeout: 15000 });
  log.push(`guest: ${await guest.evaluate(() => document.getElementById('duet-status').textContent)}`);
  log.push(`host: ${await app.evaluate(() => document.getElementById('duet-status').textContent)}`);
  await guest.screenshot({ path: `${out}/00-guest-landing.png` });

  for (const p of [app, guest]) await p.evaluate(() => document.getElementById('landing')?.classList.add('hidden'));
  // The host raises a hand: the show begins, and with a friend on the line it opens for two.
  await app.evaluate(() => window.shadowplay.demo.perform(window.shadowplay.creatures.bird));
  await app.waitForFunction(() => window.shadowplay.game.phase === 'story', null, { timeout: 20000 });
  await app.evaluate(() => window.shadowplay.demo.perform(null));

  const t0 = Date.now();
  let asks = 0;
  let lastSay = '';
  while (Date.now() - t0 < 90000) {
    const s = await app.evaluate(() => {
      const st = window.shadowplay.story;
      return { game: window.shadowplay.game.phase, phase: st.phase, ask: st.ask, prompt: st.prompt, step: st.step ? JSON.stringify(st.step) : null, cast: st.cast.join(','), title: st.title, events: JSON.stringify(st.narrator?.events.slice(-1)) };
    });
    if (s.step && s.step !== lastSay && s.step.startsWith('{"say"')) {
      lastSay = s.step;
      log.push(`say ${JSON.parse(s.step).say}`);
      if (log.filter((l) => l.startsWith('say')).length === 2) {
        await page.waitForTimeout(1200);
        await hostShot('01-host-opening');
        await guest.screenshot({ path: `${out}/01-guest-opening.png` });
      }
    }
    if (s.phase === 'telling' && !cfg.realtime) await app.evaluate(() => window.shadowplay.story.panel.finish());
    if (s.phase === 'asking') {
      asks++;
      log.push(`ask ${s.ask}: "${s.prompt}"`);
      // The friend answers from their wall.
      await guest.evaluate((ask) => window.shadowplay.demo.perform(window.shadowplay.creatures[ask === 'any' ? 'fox' : ask]), s.ask);
      await page.waitForTimeout(900);
      if (asks <= 2) {
        await hostShot(`0${asks + 1}-host-friend-casting`);
        await guest.screenshot({ path: `${out}/0${asks + 1}-guest-casting.png` });
      }
      await app.waitForFunction(() => window.shadowplay.story.phase !== 'asking', null, { timeout: 15000 }).catch(() => log.push('the friend’s shadow did not answer'));
      log.push(`made: ${await app.evaluate(() => JSON.stringify(window.shadowplay.story.narrator.events.slice(-1)[0]))}`);
      await guest.evaluate(() => window.shadowplay.demo.perform(null));
      continue;
    }
    if (s.phase === 'ending') {
      log.push(`end "${s.title}" cast ${s.cast}`);
      await page.waitForTimeout(2500);
      await hostShot('09-host-ending');
      await guest.screenshot({ path: `${out}/09-guest-ending.png` });
      break;
    }
    await page.waitForTimeout(200);
  }
  log.push(`guest saw: ${await guest.evaluate(() => JSON.stringify({ creatures: window.shadowplay.state.creatureSegCount, hostHands: window.shadowplay.state.remoteSegCount }))}`);
  await guest.close();
  writeFileSync(`${out}/log.json`, JSON.stringify(log, null, 1));
  return log;
}
