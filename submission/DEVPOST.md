# Devpost submission — Meta VR Start Developer Competition 2026

**Submission name:** Shadowplay

**Tagline (≤140):** A lantern tells a story on your real wall, and your bare hands cast it: shape a shadow and that creature walks into the tale.
(125 characters)

**Track:** Gaming
**Division:** New Experience
**Built with:** Immersive Web SDK (WebXR), three.js, TypeScript, Web Audio, Claude (Anthropic API), Vercel, MediaPipe (laptop mode only)
**Project link:** https://pswapnajit.github.io/shadowplay/
**Code:** https://github.com/pswapnajit/shadowplay

---

## Inspiration

Everyone has made a rabbit on a bedroom wall with a torch behind them, usually while someone told a story. It's one of the oldest hands-first games there is, and it only works because your real hands are in a real room in front of a real wall. Mixed reality on Quest has every ingredient: hand tracking that knows where every knuckle is, passthrough that shows your wall, and scene understanding that knows where that wall is. Shadowplay puts them together, and adds the storyteller.

## What it does

A small lantern appears in front of you, glides over your shoulder, and your real wall lights up in a warm pool while the rest of the room dims. A golden ghost hand shows you the first shape. Copy it and your shadow appears on the wall, cast by your tracked hands. Hold the match and the shadow wakes up: a Chatterbird that chirps when you open its beak.

Then the Lantern speaks. *"Every night, I tell a story. Tonight, you cast it."*

The Lantern improvises a new bedtime story, beat by beat, and you answer it with your hands. When it asks *"Who was still awake?"*, the shadow you make **is** your answer: make a fox and the fox walks into the tale. When the story needs a creature you haven't learned, its outline appears on the wall and the ghost hand shows you how. The stage reacts as the story is told: a moon rises over your wall, rain and snow fall as shadows in the lantern light, lightning flashes, wind swings the lantern so every shadow sways, and dawn warms the room at the end.

The story listens to what you actually do:
- **Make a different creature than it asked for**, and the tale bends around your surprise.
- **Take a while, or need the ghost hand's help**, and the creature becomes shy, or arrives from far away.
- **Make your creature talk** (open the bird's beak, drop the dog's jaw) and it becomes the chatty one.
- **Let an ask go** with a thumbs-up, and the story carries on without it.

Every creature you make joins the cast and acts out the Lantern's stage directions: it walks, hops, flies, hides, sleeps, howls and, at the end, bows. Each story ends with a title card and goes into your **Book of Shadows**. The next night the Lantern remembers: old friends return and earlier tales are recalled. Nine creatures to learn (six one-handed, three two-handed) and a new story every night.

**Take Claude away and Shadowplay still stands.** The theatre, shadow casting, matching, creatures and lessons are all built on-device. If the network or the story server isn't there, the Lantern's understudy, a hand-written offline storyteller, takes over mid-story without a seam.

## How we built it

- **Shadows from joints, not meshes.** Each of the 25 tracked joints per hand is a sphere and each bone a tapered capsule. Projected from the lantern onto the wall plane, a capsule's shadow is the 2D hull of two discs, so a hand is about 46 small 2D shapes. Bridges between touching fingers close the slits a bare skeleton would leave.
- **A cheap GPU pass for standalone hardware.** Each capsule is an instanced quad drawn only over its own bounds into a 256² texture with MAX blending. A separable blur then gives a physically sized penumbra: shadows grow and soften as your hand nears the lantern, and shrink and sharpen near the wall. A transparent plane on the real wall composites the pool, the shadows, the outline and the story's weather over passthrough.
- **The real wall.** Plane detection picks the vertical plane the light would really land on. Without one, a paper screen appears. The theatre follows if you move.
- **Fair matching.** Shapes are compared by intersection-over-union after normalising position and scale, across a small range of rotations, and mirror-invariant so either hand works. Targets come from a kinematic hand built on a real captured Quest skeleton, so every shape is physically makeable. Thresholds were calibrated by simulating natural hand wobble. An adaptive assist eases off for players who are close but stuck, and in a story an off-script creature must be unmistakable before it can answer.
- **The Lantern is Claude.** Claude Opus 5.5 runs behind a small serverless function. Each beat is a schema-constrained JSON script (narration lines, stage cues and creature actions in performance order, then the next ask or the end). The beat streams token by token, and the server forwards each step the moment it is complete, so the first line is on the wall before the beat has finished generating. Low effort keeps it quick, and prompt caching shares the static prompt across every player.
- **Stateless and tamper-proof.** The game holds the conversation, and every earlier beat comes back HMAC-signed, so a client can replay the Lantern's own words but never put words in its mouth. The player's side is structured events only (which creature, how long it took, whether the ghost hand helped), never free text, so the endpoint can't be used as a chatbot. Per-IP limits, an origin allowlist and a server-side refusal fallback cover the rest.
- **The stage is a shader.** The moon, stars, fireflies, lightning and dawn are drawn into the wall plane over passthrough. Rain and snow fall *between* the lantern and the wall, so they are drawn as shadows. Wind physically swings the lantern.
- **Everything is procedural.** The creatures are capsule rigs drawn by the same shadow pass. All sound is synthesised in Web Audio, with no audio files: a plucked-string melody per creature, chirps, barks and howls, rain, wind, crickets, thunder, a dawn chorus, and the Lantern's own wordless murmur as each word appears.
- **Laptop mode** runs the same game with webcam hand tracking (MediaPipe in the browser), so people without a headset can play.

## Hand interactions

The experience is hands-only from start to finish. Your hands are both the controller and the content, because the shadow *is* your hand.
- Casting and shaping shadows (continuous hand and finger pose) teaches each creature, and in a story it is how you choose who arrives.
- Mouth movements (thumb to index for the bird, little finger for the dog's jaw, hand separation for the crocodile) trigger sounds and tell the story how chatty a creature is.
- A held thumbs-up lets an ask go, skips a lesson, or asks for another story.
- Moving your hand towards the lantern makes its shadow bigger and softer, as with a real lamp.

There are no menus and no controllers, and every interaction fits within arm's reach while seated.

## Challenges

- Tracked joints are a skeleton, but shadows need skin: we added contact bridges, palm fill and a fading forearm aimed at an estimated elbow.
- Additive glows in passthrough compositing turned into dark shapes until we stopped them writing alpha.
- Matching had to be generous enough for real hands yet still tell a bird from a dog.
- Making an AI storyteller feel live in a headset: streaming each finished step out of a still-generating JSON beat, covering the gap with the Lantern's own opening lines and a creature's wake, and never letting a network failure break the story.

## Accomplishments we're proud of

The first five minutes. Within seconds of entering, with nothing to read, players see their own shadow on their own wall, copy a ghost hand and wake a creature. A minute later they are casting the characters of a story nobody has ever heard before.

## What we learned

The most magical interactions are the oldest ones. Hand tracking plus passthrough makes a hundred-year-old shadow game feel brand new, and a storyteller who listens to your hands turns it into something to come back to every night.

## What's next

- Two-player shadow plays in shared space: one person narrates, one person casts.
- Voice: tell the Lantern what tonight's story should be about.
- Shadow capture: save a scene from your story as a picture.
- Depth-aware occlusion, so real objects in the room also cast shadows.
- A Horizon Store release as an installable web app.

**Target launch date:** January 2027 (web), with a Horizon Store PWA listing to follow.

**Team:** Swapnajit Patra (solo).
