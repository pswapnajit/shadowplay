# Devpost submission: Meta VR Start Developer Competition 2026

**Submission name:** Shadowplay

**Tagline (≤140):** A lantern tells a story on your real wall, and your bare hands cast it: shape a shadow and that creature walks into the tale.
(125 characters)

**Track:** Entertainment (immersive storytelling). Gaming fits too; see `SUBMIT.md` for the choice.
**Division:** New Experience
**Built with:** Immersive Web SDK, WebXR, three.js, TypeScript, Web Audio, WebRTC, PeerJS, Claude, Vercel, MediaPipe
**Project link:** https://pswapnajit.github.io/shadowplay/
**Code:** https://github.com/pswapnajit/shadowplay
**Target launch date:** January 2027 (web), then a Horizon Store listing as an installable web app.
**Team:** Swapnajit Patra (solo).

---

## Description (paste into the form: 497 words)

### Inspiration

Everyone has made a rabbit on a bedroom wall with a torch, usually while someone told a story. It only works with real hands in front of a real wall. Quest has every ingredient (hand tracking, passthrough, scene understanding), so Shadowplay puts them together and adds the storyteller.

### What it does

A paper lantern glides over your shoulder and your real wall lights up as a stage. Copy the golden ghost hand's shape and your shadow wakes up as a creature. No menus, nothing to read.

Then the Lantern tells tonight's story, improvised live, and you cast it. When it asks "Who was still awake?", the shadow you make is the answer: make a fox and the fox walks into the tale. Surprise it, and the story bends around you. The stage plays along: a moon rises over your wall, rain and snow fall as shadows, and wind swings the lantern so every shadow sways.

Then come back tomorrow. Every tale leaves a paper keepsake on a garland across your wall, and ends with a promise ("Tomorrow, I'll tell you how the fox lost the moon's reflection") that the Lantern keeps the next night. The moon grows each night you return; when it's full, old friends come back for a Full Moon Tale.

Or play with a friend: they join with a code from their own wall, anywhere (Quest or laptop webcam). Their shadows fall in blue on yours, and the Lantern tells one story to you both.

It's inclusive by default (captions, read-aloud, either hand, seated), with options for hands-free "look to choose" (every hand action has a gaze twin), one-hand stories, gentle shapes, a calm stage, bigger words and high contrast.

### How we built it

- Immersive Web SDK (WebXR), three.js, TypeScript: open a link, no install.
- Shadows come from the 25 tracked joints of each hand, projected from the lantern as capsules and drawn on the GPU with a physical penumbra. Plane detection finds the wall the light would really land on.
- Matching compares shapes by intersection-over-union across rotations and mirrors, with decoys and finger checks so a resting hand never passes.
- The Lantern is Claude Haiku 5.5 behind a small serverless function. Each beat is schema-constrained JSON, streamed step by step, so the first line reaches the wall while the rest is being written. The history is HMAC-signed and the player's side is structured events only, so it can't be turned into a chatbot.
- Take Claude away and Shadowplay still stands: an offline understudy storyteller takes over, even mid-story.
- Two players connect peer to peer over WebRTC, and only shadow shapes travel: never camera images or the room.
- All sound is synthesised and spatial: each creature is heard from its place on the wall.

### Challenges

Making an AI storyteller feel live: streaming finished steps out of half-written JSON, covering the wait with the Lantern's own lines, and never letting a network failure break the story.

### What's next

Choosing what tonight's story is about, more creatures, and a Horizon Store release. Target launch: January 2027.

---

## How hand interactions are implemented (optional field)

The experience is hands-only from start to finish. Your hands are both the controller and the content, because the shadow *is* your hand.

- Casting and shaping shadows (continuous hand and finger pose) teaches each creature, and in a story it decides who arrives.
- Mouth movements (thumb to index for the bird, little finger for the dog's jaw, hand separation for the crocodile) make creatures speak, and tell the story how chatty they are.
- A held thumbs-up lets an ask go, skips a lesson, or asks for another story.
- Moving a hand towards the lantern makes its shadow bigger and softer, as with a real lamp.
- Everything fits within arm's reach while seated, and for players who can't use their hands, every interaction has a gaze twin.

What excites me about the future of VR: the oldest interactions feel brand new when hand tracking meets your own room. A hundred-year-old shadow game becomes something you come back to every night, because now the wall can tell you a story back.
