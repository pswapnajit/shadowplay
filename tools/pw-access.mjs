// Hands-free story check in IWER: a returning player (four earlier nights, their
// keepsakes, last night's promise) plays a whole story with "look to choose",
// by pointing the emulated headset at outlines and shelf creatures.
//   1. tools/pw-access.json {"step": "prep"}  → npx @iwsdk/cli browser run tools/pw-access.mjs
//   2. npx @iwsdk/cli xr enter, then disconnect the controllers and hands (xr set-connected)
//   3. tools/pw-access.json {"step": "run"}   → npx @iwsdk/cli browser run tools/pw-access.mjs --timeout 110000
// Other options: "query" (default ?look&narrator=offline&voice=off), "realtime" (don't fast-forward narration).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const DAY = 86_400_000;

export default async function run({ page, frame, workspaceRoot }) {
  const cfgPath = `${workspaceRoot}/tools/pw-access.json`;
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
  const app = frame ?? page;
  const out = `${workspaceRoot}/tools/out/access`;
  mkdirSync(out, { recursive: true });
  const el = frame ? await frame.frameElement() : null;
  const shot = (name) => (el ? el.screenshot({ path: `${out}/${name}.png` }) : page.screenshot({ path: `${out}/${name}.png` }));
  const log = [];

  if (cfg.step !== 'run') {
    const now = Date.now();
    const at = (daysAgo) => now - daysAgo * DAY;
    const tales = [
      { title: 'The Fox and the Missing Moon', summary: 'A fox searched for the moon.', cast: ['fox', 'bird'], at: at(6), by: 'understudy', keepsake: 'moon' },
      { title: 'The Rabbit Goes to the Sea', summary: 'A rabbit saw the sea.', cast: ['rabbit'], at: at(4), by: 'understudy', keepsake: 'shell' },
      { title: 'The Dog and the Small Sad Sound', summary: 'A dog found a lonely windmill.', cast: ['dog', 'wolf'], at: at(2), by: 'understudy', keepsake: 'bell' },
      {
        title: 'The Chatterbird and the Fallen Star',
        summary: 'A bird carried a star home.',
        cast: ['bird', 'fox'],
        at: at(1),
        by: 'understudy',
        keepsake: 'star',
        promise: "Tomorrow, I'll tell you how the fox lost the moon's reflection.",
        plan: { quest: 0, who: 'fox' },
      },
    ];
    await app.evaluate((book) => {
      localStorage.setItem('shadowplay.book.v1', JSON.stringify(book));
      localStorage.setItem('shadowplay.v1', JSON.stringify({ collected: ['bird', 'rabbit', 'dog', 'fox', 'wolf'] }));
      localStorage.removeItem('shadowplay.access.v1');
    }, tales);
    const url = new URL(app.url());
    url.search = cfg.query ?? '?look&narrator=offline&voice=off';
    await app.goto(url.toString(), { waitUntil: 'load' });
    await app.waitForFunction(() => window.shadowplay?.game?.phase === 'intro', null, { timeout: 20000 }).catch(() => {});
    await app.evaluate(() => {
      document.getElementById('access').open = true;
    });
    await page.waitForTimeout(800);
    await shot('00-landing');
    return ['loaded', await app.evaluate(() => document.getElementById('tonight').textContent)];
  }

  // Points the headset at wall point (x, y), level, like a seated player turning their head.
  const aim = (x, y) =>
    app.evaluate(
      ([x, y]) => {
        const st = window.shadowplay.state.stage;
        const H = window.shadowplay.state.head.position;
        const W = st.wallPoint;
        const R = st.wallRight;
        const U = st.wallUp;
        const d = [0, 1, 2].map((i) => W[i] + R[i] * x + U[i] * y - H[i]);
        const len = Math.hypot(...d);
        const yaw = Math.atan2(-d[0] / len, -d[2] / len);
        const pitch = Math.asin(d[1] / len);
        const [cy, sy, cp, sp] = [Math.cos(yaw / 2), Math.sin(yaw / 2), Math.cos(pitch / 2), Math.sin(pitch / 2)];
        window.IWER_DEVICE.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
      },
      [x, y],
    );

  await app.waitForFunction(() => window.shadowplay.game.phase === 'story', null, { timeout: 20000 });
  await aim(0, 0.1);
  const t0 = Date.now();
  let last = '';
  let n = 0;
  let opened = false;
  let endShots = 0;
  while (Date.now() - t0 < (cfg.budgetMs ?? 100000)) {
    const s = await app.evaluate(() => {
      const g = window.shadowplay.game;
      const st = window.shadowplay.story;
      const shelf = g.living.filter((l) => l.mode === 'home' && !l.visitor).map((l) => ({ id: l.def.id, x: l.x, y: l.y, s: l.s }));
      return {
        phase: g.phase,
        sp: st.phase,
        ask: st.ask,
        prompt: st.prompt,
        step: st.step ? JSON.stringify(st.step) : null,
        cast: st.cast.join(','),
        title: st.title,
        night: st.night,
        outline: [g.ox, g.oy],
        shelf,
        gaze: g.gazeKind,
        endT: st.endT,
        garland: g.garland.count,
      };
    });
    const key = `${s.phase}/${s.sp}/${s.ask}`;
    if (key !== last) {
      last = key;
      log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${key} cast=${s.cast} night=${s.night} garland=${s.garland}`);
    }
    if (s.step?.startsWith('{"say"') && !log.includes(`say ${s.step}`)) log.push(`say ${s.step}`);
    if (s.sp === 'telling' && !opened && s.step?.startsWith('{"say"')) {
      opened = true;
      await page.waitForTimeout(1600);
      await shot(`${String(++n).padStart(2, '0')}-opening`);
    }
    if (s.sp === 'telling' && !cfg.realtime) await app.evaluate(() => window.shadowplay.story.panel.finish());
    if (s.sp === 'asking') {
      // An outline to look at, or a friend on the shelf.
      if (s.ask !== 'any') await aim(s.outline[0], s.outline[1]);
      else {
        const pick = s.shelf[(n + 1) % s.shelf.length];
        const h = { wolf: 0.34, fox: 0.24, deer: 0.48, bird: 0.2, rabbit: 0.3, dog: 0.3, swan: 0.32, crocodile: 0.12, butterfly: 0.15 }[pick.id];
        await aim(pick.x, pick.y + (h * pick.s) / 2);
      }
      await page.waitForTimeout(800);
      await shot(`${String(++n).padStart(2, '0')}-ask-${s.ask}-looking`);
      await app.waitForFunction(() => window.shadowplay.story.phase !== 'asking', null, { timeout: 8000 }).catch(() => log.push('look did not answer'));
      await aim(0, 0.1);
    }
    if (s.sp === 'ending' && endShots === 0 && s.endT > 1.8) {
      endShots++;
      await shot(`${String(++n).padStart(2, '0')}-keepsake`);
    }
    if (s.sp === 'ending' && endShots === 1 && s.endT > 7) {
      endShots++;
      await shot(`${String(++n).padStart(2, '0')}-promise`);
    }
    if (s.phase === 'free') {
      await page.waitForTimeout(1500);
      await shot(`${String(++n).padStart(2, '0')}-free`);
      break;
    }
    await page.waitForTimeout(150);
  }
  log.push(await app.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('shadowplay.book.v1')).slice(-1)[0])));
  writeFileSync(`${out}/log.json`, JSON.stringify(log, null, 1));
  return log;
}
