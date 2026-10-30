// Checks that narration follows the speaking voice (run with ?voice=silent so nothing is heard).
export default async function run({ page, frame }) {
  const app = frame ?? page;
  const url = new URL(app.url());
  url.search = '?narrator=offline&voice=silent';
  await app.evaluate(() => {
    localStorage.removeItem('shadowplay.book.v1');
    localStorage.setItem('shadowplay.v1', JSON.stringify({ collected: ['bird'] }));
  });
  await app.goto(url.toString(), { waitUntil: 'load' });
  await app.waitForFunction(() => window.shadowplay?.game?.phase === 'intro', null, { timeout: 20000 });
  await page.mouse.click(4, 4); // a user gesture, as on the landing page
  await app.evaluate(() => window.shadowplay.demo.perform(window.shadowplay.creatures.bird));
  await app.waitForFunction(() => window.shadowplay.game.phase === 'story', null, { timeout: 15000 });
  await app.evaluate(() => window.shadowplay.demo.perform(null));
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 16000) {
    samples.push(await app.evaluate(() => {
      const st = window.shadowplay.story;
      return `${st.step?.say?.slice(0, 24) ?? '-'} shown=${st.panel.shown} heard=${st.panel.heard} speaking=${st.constructor && window.speechSynthesis.speaking}`;
    }));
    await page.waitForTimeout(800);
  }
  return samples;
}
