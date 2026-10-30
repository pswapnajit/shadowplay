// Look to choose on a screen: the pointer stands in for the head. Plays the first
// ask of a story by hovering over a creature on the shelf.
//   npx @iwsdk/cli browser run tools/pw-look-desktop.mjs --timeout 60000
import { mkdirSync } from 'node:fs';

export default async function run({ page, frame, workspaceRoot }) {
  const app = frame ?? page;
  const out = `${workspaceRoot}/tools/out/access`;
  mkdirSync(out, { recursive: true });
  const el = frame ? await frame.frameElement() : null;
  const shot = (name) => (el ? el.screenshot({ path: `${out}/${name}.png` }) : page.screenshot({ path: `${out}/${name}.png` }));
  await app.evaluate(() => {
    localStorage.removeItem('shadowplay.book.v1');
    localStorage.setItem('shadowplay.v1', JSON.stringify({ collected: ['bird', 'dog'] }));
  });
  const url = new URL(app.url());
  url.search = '?look&narrator=offline&voice=off';
  await app.goto(url.toString(), { waitUntil: 'load' });
  await app.waitForFunction(() => window.shadowplay?.game?.phase === 'intro', null, { timeout: 20000 });
  // As if the webcam had started: someone is playing.
  await app.evaluate(() => {
    document.getElementById('landing').classList.add('hidden');
    window.shadowplay.state.audience = true;
  });
  await app.waitForFunction(() => window.shadowplay.story.phase === 'asking', null, { timeout: 40000 });
  const log = [`asked ${await app.evaluate(() => window.shadowplay.story.ask)}`];
  // Hover over the dog on the shelf, as a mouse, head mouse or eye tracker would.
  const hover = () =>
    app.evaluate(() => {
      const { game, world } = window.shadowplay;
      const st = window.shadowplay.state.stage;
      const dog = game.living.find((l) => l.def.id === 'dog' && l.mode === 'home');
      const y = dog.y + game.shelfLift + (0.3 * dog.s) / 2;
      const V = world.camera.position.constructor;
      const p = new V(...[0, 1, 2].map((i) => st.wallPoint[i] + st.wallRight[i] * dog.x + st.wallUp[i] * y)).project(world.camera);
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: ((p.x + 1) / 2) * innerWidth, clientY: ((1 - p.y) / 2) * innerHeight }));
      return game.gazeKind;
    });
  for (let i = 0; i < 4; i++) {
    log.push(`gaze ${await hover()}`);
    await page.waitForTimeout(300);
  }
  await shot('desktop-look');
  for (let i = 0; i < 8; i++) {
    await hover();
    await page.waitForTimeout(250);
  }
  log.push(await app.evaluate(() => `after: ${window.shadowplay.story.phase}, cast ${window.shadowplay.story.cast.join(',')}`));
  return log;
}
