// Screenshots each story stage cue on the loaded page (run after entering XR, or on the desktop view).
//   npx @iwsdk/cli browser run tools/pw-fx.mjs --timeout 100000
import { mkdirSync } from 'node:fs';

export default async function run({ page, frame, workspaceRoot }) {
  const app = frame ?? page;
  const out = `${workspaceRoot}/tools/out/fx`;
  mkdirSync(out, { recursive: true });
  const el = frame ? await frame.frameElement() : null;
  const shot = (name) => (el ? el.screenshot({ path: `${out}/${name}.png` }) : page.screenshot({ path: `${out}/${name}.png` }));
  await app.evaluate(() => document.getElementById('landing')?.classList.add('hidden'));
  const scenes = [
    ['night-moon', ['night', 'moon'], 7500],
    ['stars', ['stars'], 3000],
    ['fireflies', ['calm', 'fireflies'], 3500],
    ['rain', ['rain'], 3000],
    ['thunder', ['thunder'], 120],
    ['snow', ['calm', 'snow'], 3500],
    ['wind', ['calm', 'wind'], 3000],
    ['dawn', ['dawn'], 5000],
  ];
  const done = [];
  for (const [name, cues, wait] of scenes) {
    await app.evaluate((cs) => cs.forEach((c) => window.shadowplay.story.fx.cue(c)), cues);
    await page.waitForTimeout(wait);
    await shot(name);
    done.push(name);
  }
  await app.evaluate(() => window.shadowplay.story.fx.reset());
  return done;
}
