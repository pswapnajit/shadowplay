# Devpost submission — Meta VR Start Developer Competition 2026

**Submission name:** Shadowplay

**Tagline (≤140):** Your wall becomes a shadow theatre: shape your hands until the shadow matches, and it wakes up, chirps, hops and comes home.
(129 characters)

**Track:** Gaming
**Division:** New Experience
**Built with:** Immersive Web SDK (WebXR), three.js, TypeScript, Web Audio, MediaPipe (laptop mode only)
**Project link:** https://pswapnajit.github.io/shadowplay/ *(live once the repo is published)*
**Code:** https://github.com/pswapnajit/shadowplay

---

## Inspiration

Everyone has made a rabbit on a bedroom wall with a torch behind them. It's one of the oldest hands-first games there is, and it only works because your real hands are in a real room in front of a real wall. Mixed reality on Quest has every ingredient: hand tracking that knows where every knuckle is, passthrough that shows your wall, and scene understanding that knows where that wall is. Shadowplay puts them together: a lantern over your shoulder, your hands, and shadows that come alive.

## What it does

When you enter, a small lantern appears in front of you, glides over your shoulder, and your real wall lights up in a warm pool while the rest of the room dims. A golden ghost hand shows you the first shape. Copy it and your shadow appears on the wall, cast by your tracked hands. An outline shows the creature you're aiming for and glows brighter as you get closer. Hold the match for a moment and the shadow wakes up: a flash, a short melody, and a living shadow creature that hops, trots, glides or flutters across your wall to a shelf where your collection lives.

Some shadows talk back. Open the Chatterbird's beak and it chirps; drop the dog's jaw and it barks. Six creatures (four one-handed, two two-handed) lead into free play, where any shape you've learned summons its creature again. Your menagerie is saved, so the creatures are waiting on your wall next time.

## How we built it

- **Shadows from joints, not meshes.** Each of the 25 tracked joints per hand is a sphere and each bone a tapered capsule. Projected from the lantern onto the wall plane, a capsule's shadow is the 2D hull of two discs, so a hand is about 46 small 2D shapes. Bridges between touching fingers close the slits a bare skeleton would leave.
- **A cheap GPU pass for standalone hardware.** Each capsule is an instanced quad drawn only over its own bounds into a 256² texture with MAX blending, then a separable blur gives a physically sized penumbra: shadows grow and soften as your hand nears the lantern, and shrink and sharpen near the wall. A transparent plane on the real wall composites the pool, shadow, outline and effects over passthrough.
- **The real wall.** Plane detection picks the vertical plane the light would really land on; without one, a paper screen appears. The theatre follows if you move.
- **Matching that's fair.** Shapes are compared by intersection-over-union after normalising position and scale, across a small range of rotations, mirror-invariant so either hand works. Targets come from a kinematic hand built on a real captured Quest skeleton, so every shape is physically makeable. We calibrated thresholds by simulating natural hand wobble, and an adaptive assist eases off for players who are close but stuck.
- **Everything procedural.** The creatures are capsule rigs drawn by the same shadow pass. All sound is synthesised in Web Audio: a plucked-string melody per creature, chimes, chirps and barks, plus a candle-crackle room tone. No asset downloads, fast cold start.
- **A laptop mode** runs the same game with webcam hand tracking (MediaPipe in the browser). We used it to test with real hands throughout development, and it makes the experience shareable with people who don't own a headset.

## Hand interactions

The experience is hands-only from start to finish. Your hands are the controller and the content: the shadow is your hand. Interactions:
- casting and shaping shadows (continuous hand and finger pose),
- mouth movements (thumb-to-index distance for the bird, little finger for the dog's jaw, hand separation for the crocodile) that trigger sounds,
- a held thumbs-up to skip,
- distance to the lantern controls the shadow's size and softness, just like a real lamp.

No pinching menus or controllers are required.

## Challenges

- Tracked joints are a skeleton, but shadows need skin: we added contact bridges, palm fill and a fading forearm aimed at an estimated elbow.
- Additive glows in passthrough compositing turned into dark shapes until we stopped them writing alpha.
- Matching had to be generous enough for real hands yet still tell a bird from a dog. Simulated wobble testing set the thresholds, with a margin rule in free play.

## Accomplishments we're proud of

The first five minutes: within seconds of entering, with no text to read, players see their own shadow on their own wall, copy a ghost hand, and wake a creature that chirps back at them.

## What we learned

The most magical interactions are the oldest ones. Hand tracking plus passthrough makes a hundred-year-old shadow game feel brand new.

## What's next

- More creatures and story chapters: a nightly "visitor" shape, and two-player shadow plays in shared space.
- Shadow capture: photograph your shadow and share it.
- Depth-aware occlusion so real objects in the room also cast shadows.
- A Horizon Store release as an installable web app.

**Target launch date:** January 2027 (web), with a Horizon Store PWA listing to follow.

**Team:** Swapnajit Patra (solo).
