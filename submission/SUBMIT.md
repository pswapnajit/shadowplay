# Submitting Shadowplay to the Meta VR Start Developer Competition

Deadline: **Nov 18, 2026, 12:00 PT = Nov 19, 01:30 IST.** Aim to submit by Nov 15 so there's slack.

## 1. Eligibility (do this first; approvals can take days)
- [ ] **Meta VR Start program membership.** Apply from the competition page ("If you're not already a member of the Start program, apply now"). It's required *by the time of submission*. Use the same Meta developer account you already have.
- [ ] **Join the hackathon** on https://start-developer-competition-26.devpost.com/ ("Join hackathon").

## 2. Turn on the Lantern (story mode): done
- [x] Vercel project `shadowplay` imported with `ANTHROPIC_API_KEY`, live at **https://shadowplay-beta.vercel.app** (the game and `/api/story` on one origin). Every push to `main` redeploys it.
- [x] The GitHub Pages build calls `https://shadowplay-beta.vercel.app/api/story` (`STORY_API_FOR_PAGES`), checked end to end. Model: Claude Haiku 5.5 (well under a cent per story).
- [ ] Vercel → shadowplay → Settings → Environment Variables: add **`OPENAI_API_KEY`** (the Lantern's voice), then redeploy. Until then the site reads with the device's voice.
- [ ] Set **monthly spend limits** on both keys (Anthropic about $20, OpenAI about $20; a story costs about 4 cents of voice), and replace both keys after winners are announced.

## 3. Video: done, ready to upload
**`~/Desktop/shadowplay-demo-v2.mp4`** (2:37, 1280×720), cut by `tools/build-demo.py` from recordings in Meta's IWER Quest 3 emulator (scripted hands; the game reacts for real). It leads with the story, as the rules ask:
1. **First night (1:32).** The lantern arrives, the ghost hand teaches the first shape, then a live Claude story: the player's shadows answer the asks, a fox turns up instead of the bird the Lantern asked for and the tale bends around it, lightning and dawn, then the title card, the keepsake dropping onto the garland, and the Lantern's promise for tomorrow.
2. **The next night (0:31).** The moon has grown, the keepsakes are still on the wall, the Lantern keeps its promise, and the first answer is given hands-free, by looking.
3. **With a friend (0:29).** Two walls, two lanterns, one story: the friend's shadow (in blue) answers from their laptop, shown inset.
4. **End card** with the link, and a credit saying it's the emulator with scripted hands, stories by Claude, voice by OpenAI text-to-speech.

The Lantern's voice in the video is the game's own (recorded in the page), not dubbed.
- [ ] Upload to **YouTube as Public** (Unlisted isn't enough; the rules say publicly visible). Audience: *No, it's not made for kids* (that setting turns off comments and other features). Category: Gaming.
  - Title: `Shadowplay: a hand-shadow theatre with an AI storyteller, for Meta Quest (WebXR)`
  - Thumbnail: `~/Desktop/shadowplay-thumbnail.jpg` (custom thumbnails need a phone-verified YouTube account; skip it otherwise)
  - Description (the timestamps become chapters):
    ```
    A lantern tells a story on your real wall, and your bare hands cast it: shape a shadow and that creature walks into the tale.

    Play it (Meta Quest Browser, or a laptop with a webcam): https://pswapnajit.github.io/shadowplay/
    Code: https://github.com/pswapnajit/shadowplay

    0:00 The first night: a ghost hand teaches the first shape, then a live story
    1:32 The next night: the moon has grown, the keepsakes stay, the promise is kept
    2:03 Play with a friend: two walls, two lanterns, one story

    Footage: Meta IWER Quest 3 emulator with scripted hand input. Stories improvised live by Claude; the Lantern's voice is OpenAI text-to-speech.
    Made for the Meta VR Start Developer Competition 2026.
    ```
- [ ] Paste the YouTube URL into the form.

## 4. Track: Entertainment or Gaming?

One entry per person, one prize per entry, so the track is the biggest single choice. Both tracks pay the same ($100,000 winner, $50,000 runner-up), and Meta can move an entry between tracks.
- **Entertainment (recommended).** The track text names "immersive storytelling" and "interactive video", which is what story mode is. It will likely draw fewer, less game-polished entries than Gaming, and last year's Entertainment winner (DreamSpace) was also a turn-your-room-into-something mixed reality piece.
- **Gaming.** Also a clean fit ("narrative", "casual", "puzzle", seated, hands-first), but it's where most studios with polished Unity games will enter.

## 5. The form (copy from `submission/DEVPOST.md`)
| Field | Value |
|---|---|
| Name | Shadowplay |
| Tagline | A lantern tells a story on your real wall, and your bare hands cast it: shape a shadow and that creature walks into the tale. |
| Track | Entertainment (see section 4) |
| Division | New Experience |
| Project link | https://pswapnajit.github.io/shadowplay/ (the main link: if Vercel ever has trouble, this copy still loads and falls back to the offline storyteller and the device's voice) |
| Try it out links | add all three: the project link, the mirror https://shadowplay-beta.vercel.app, and the code |
| Code | https://github.com/pswapnajit/shadowplay |
| Built with | Immersive Web SDK, WebXR, three.js, TypeScript, Web Audio, WebRTC, PeerJS, Claude, OpenAI text-to-speech, Vercel, MediaPipe |
| Description | the "Description" section of DEVPOST.md (497 words; the form suggests 500 or fewer) |
| Hand interactions | the "How hand interactions are implemented" section of DEVPOST.md |
| Target launch date | January 2027 |
| Images | upload `submission/gallery/story-*.jpg` first (story, keepsake, next night, look to choose, a friend's shadow), then any of the others |

## 6. Every prize, and what Shadowplay brings to it

One entry can win only one prize, so the aim is to be a strong candidate for as many as possible: judges award the special prizes across all entries.

| Prize | Fit | What Shadowplay brings |
|---|---|---|
| Best New Entertainment Experience ($100k / $50k runner-up) | Main target | Immersive storytelling on your own wall: an improvised tale you cast with your hands. |
| Best New Gaming Experience ($100k / $50k) | Alternative track | A seated, hands-first narrative and puzzle game with nine creatures to learn. |
| Best Agentic Interaction ($25k) | Strong | The Lantern is a spatial agent: it improvises with Claude, reacts to what your hands actually do (surprises, help, chatter, silence), remembers earlier nights, and keeps its own promises. |
| Best Reason to Come Back ($25k) | Strong | A moon that grows every night you return (full moon: old friends come back), a keepsake garland that grows on your wall, a promise for tomorrow that's kept, the Book of Shadows, the menagerie. |
| Best First Five Minutes ($25k) | Strong | No text to read: the lantern's entrance, a ghost hand to copy, a creature awake within a minute, then straight into a live story. |
| Best Accessibility Forward Experience ($25k) | Good | Captions and read-aloud, either hand, seated; options for hands-free look to choose (every hand action has a gaze twin), one hand, gentle shapes, calm stage, bigger words, high contrast. |
| Boldest Original Concept ($25k) | Strong | It only works with real hands in front of a real wall: on any other platform it falls apart. |
| Judge's Choice ($20k, 2 winners) | Possible | It straddles a game and a storytelling experience. |
| Best Social & Multiplayer Experience ($25k) | Good | Play with a friend: a four-letter code links two walls anywhere (Quest or laptop webcam), peer to peer. Shared stage, two lanterns, the friend's shadows in blue, one story told to both, and only shadow shapes travel. |
| Productivity, and all Adapted / Significantly Updated prizes | No | Not a productivity app, and the Adapted division is for projects that existed before Sept 24. |

**The "take it away" test** (from the rules): without Claude, Shadowplay still works fully. The theatre, matching, creatures and lessons are built on-device, and the offline understudy tells the stories. DEVPOST.md says so explicitly.

## 7. Before you press Submit
- [ ] Open the project link once in a desktop browser to confirm it loads, then press *Try with your webcam* and check that a story starts after the first creature.
- [ ] Open *Comfort & access*, turn on *Look to choose*, and check that hovering the pointer over an outline fills the gold ring and wakes the creature.
- [ ] Two players: press *Play with a friend* on one device, open the invite link on another (a phone hotspot works), start the webcam on both, and check that each wall shows the other's shadow.
- [ ] Keep the GitHub Pages site and the Vercel project (and the API key) up until winners are announced (~Dec 11). Pages deploys on every push to `main`.
