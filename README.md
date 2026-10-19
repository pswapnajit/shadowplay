# Shadowplay

**Your wall becomes a shadow theatre.** A lantern glows over your shoulder; your hands cast soft shadows on the real wall in front of you. Shape the shadow until it matches the outline, and it wakes up: a bird that chirps when you open its beak, a rabbit that hops away, a dog that barks when you drop your little finger.

Shadowplay is a hands-first, seated mixed-reality game for Meta Quest, built on the web with Meta's Immersive Web SDK (WebXR). It needs no controllers, no store install and no account. Open the link and play.

- **Play on Quest:** open the GitHub Pages link in Meta Quest Browser and press *Enter the theatre*. Sit facing a wall about 1–3 m away.
- **Play on a laptop:** open the same link and press *Try with your webcam*. Hand tracking runs in the browser, and the screen becomes the wall.

![The puppet shapes, as cast by the engine](docs/puppet-shapes.png)

## How a session goes

1. **The lantern arrives.** A small light appears in front of you, glides over your shoulder, and your wall lights up in a warm pool. The rest of the room dims.
2. **A golden ghost hand shows you the first shape.** You copy it, and your shadow appears on the wall: your real wall, found with scene understanding.
3. **Match the outline.** The outline glows as your shadow gets closer. Hold the match for a moment and the shadow wakes up with a flash and its own little melody.
4. **The menagerie.** Every creature you wake walks, hops or flies to a shelf at the bottom of the light, and it's still there next time you play.
5. **Free play.** Once you've met them all, make any of the shapes, any time, and that creature comes out to play.

![Living shadows, drawn with the same capsule primitives as your hands](docs/living-shadows.png)

## Creatures

| Creature | How to make it | Hands |
|---|---|---|
| Chatterbird | Hand on its side, fingers together on top, thumb underneath. Open and close the beak to make it chirp. | 1 |
| Rabbit | A loose fist with two fingers up in a V. | 1 |
| Dog | Palm towards you, fingers across, thumb up for an ear. Drop your little finger to bark. | 1 |
| Wolf | The dog, nose tipped up to the sky. Drop the jaw to howl. | 1 |
| Fox | Thumb touching your middle and ring fingers; index and little finger up as ears. | 1 |
| Swan | Forearm up as the neck, hand bent forward as the head and beak. | 1 |
| Crocodile | Two flat hands, one on top of the other. Open your wrists to snap. | 2 |
| Deer | One hand on its side is the head; the other, fingers spread, is the antlers. | 2 |
| Butterfly | Cross your wrists, hook your thumbs, spread your fingers. | 2 |

## Accessibility and comfort

- **Seated and still:** everything happens within arm's reach, with no locomotion and no standing.
- **Hands only, no text required:** a ghost hand demonstrates every pose. Hints appear only if you seem stuck.
- **Adaptive assist:** if you're close but stuck, matching gently becomes more forgiving.
- **Thumbs-up to skip:** hold a thumbs-up to move past any creature; it waits for you in free play.
- **One-handed by default:** six of the nine creatures need just one hand, and either hand works (shapes are matched mirror-invariant).
- **Short sessions:** each creature takes under a minute, and progress saves automatically.
- **Laptop mode:** the full game also runs with a webcam, for anyone without a headset.

## How it works

**Shadows from hand tracking.** Each tracked joint (25 per hand, from WebXR Hand Input) is treated as a sphere and each bone as a tapered capsule. Cast from the lantern's position onto the wall plane, a sphere becomes a disc and a capsule becomes the 2D convex hull of two discs. So a hand's shadow is about 46 small 2D shapes rather than a mesh. Bridges between touching fingers close the gaps that a bare skeleton would leave, and a short forearm, aimed at an estimated elbow, fades into the dark.

**GPU pass.** Every capsule is drawn as an instanced quad covering only its own bounds into a 256² texture, combined with `MAX` blending. A separable blur then turns hard edges into a penumbra sized from the lantern's radius and the hand's magnification: hands close to the lantern cast big, soft shadows, and hands close to the wall cast small, sharp ones. A transparent plane on the real wall paints the light pool, the shadows, the target outline and the wake-up flash, over passthrough.

**The real wall.** Scene understanding (WebXR plane detection) finds the vertical plane that the lantern's light would actually hit and places the stage on it. With no wall in view, a virtual paper screen appears 1.6 m ahead. If you move more than 30 cm, the theatre follows.

**Matching.** A shadow is rasterised, centred on its centroid and scaled to unit area, then compared with each target by intersection-over-union across a small range of rotations and both mirror images. Targets are generated from a kinematic hand model built on a real captured Quest hand skeleton (bone lengths and joint radii), so every shape is one a real hand can make. Thresholds were calibrated by jittering each pose the way real hands wobble (±12° per finger joint, ±10° wrist, ±3 cm); see `tools/calibrate.ts`.

**Living shadows.** Woken creatures are procedural rigs built from the same capsule primitives, drawn by the same pass, so they share the shadows' soft look.

**Sound.** Everything is synthesised in Web Audio: a plucked-string melody per creature (Karplus–Strong), chimes, chirps and barks, plus a room tone with candle crackle. There are no audio files.

**Webcam mode.** MediaPipe's hand landmarker (run locally in the browser, self-hosted) gives 21 landmarks per hand. They are mapped onto the same 25-joint skeleton the headset uses, with metacarpal joints placed where a real tracked hand has them. A round-trip test (`tests/webcam-bridge.test.ts`) checks that a hand passed through the webcam path casts the same shadow.

## Development

```bash
npm install
npm run dev          # IWSDK dev server with the IWER headset emulator
npm run build        # production build to dist/
npx vitest run       # unit tests
npx tsx tools/render-poses.ts   # render target silhouettes to tools/out/
npx tsx tools/calibrate.ts      # matching robustness report
```

Useful URL flags: `?demo=bird` (or `rabbit`, `dog`, `swan`, `crocodile`, `butterfly`) plays a creature on synthetic hands, which is handy for testing without hand tracking.

Code map: `src/core/` holds pure TypeScript (hand model, shadow geometry, rasteriser, matcher, creatures, rigs) that is unit-testable in Node. `src/runtime/` holds the IWSDK systems (theatre, game, renderer, audio, webcam, ghost hand).

## Credits and licences

- Code: MIT (see `LICENSE`).
- Built with Meta's [Immersive Web SDK](https://github.com/facebook/immersive-web-sdk) (MIT) and three.js (MIT).
- The reference hand skeleton comes from the IWER emulator's captured "relaxed" Quest hand pose (MIT, Meta Platforms).
- Webcam hand tracking: [MediaPipe Tasks Vision](https://developers.google.com/mediapipe) and its hand landmarker model (Apache 2.0, Google).
