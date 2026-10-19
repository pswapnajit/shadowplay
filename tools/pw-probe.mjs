export default async function run({ page, frame }) {
  return {
    pageUrl: page.url(),
    frameUrl: frame?.url?.(),
    frames: page.frames().map((f) => f.url()),
    hasGameInFrame: frame ? await frame.evaluate(() => !!window.shadowplay) : null,
    errors: frame ? await frame.evaluate(() => document.title) : null,
  };
}
