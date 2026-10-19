// Playwright helper for the IWSDK managed browser (the app runs in `frame`).
// Usage: npx @iwsdk/cli browser run tools/pw-shot.mjs   (reads tools/pw-shot.json)
import { readFileSync, writeFileSync } from 'node:fs';
export default async function run({ page, frame, workspaceRoot }) {
  const cfg = JSON.parse(readFileSync(`${workspaceRoot}/tools/pw-shot.json`, 'utf8'));
  const app = frame ?? page;
  const out = [];
  if (cfg.url) await app.goto(cfg.url, { waitUntil: 'load' });
  for (const step of cfg.steps ?? []) {
    if (step.wait) await page.waitForTimeout(step.wait);
    if (step.eval) out.push(await app.evaluate(step.eval));
    if (step.shot) {
      const el = frame ? await frame.frameElement() : null;
      if (el) await el.screenshot({ path: step.shot });
      else await page.screenshot({ path: step.shot });
      out.push(`shot:${step.shot}`);
    }
  }
  writeFileSync(`${workspaceRoot}/tools/out/pw-result.json`, JSON.stringify(out, null, 2));
  return out;
}
