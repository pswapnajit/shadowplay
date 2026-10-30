# Submitting Shadowplay to the Meta VR Start Developer Competition

Deadline: **Nov 18, 2026, 12:00 PT = Nov 19, 01:30 IST.** Aim to submit by Nov 15 so there's slack.

## 1. Eligibility (do this first; approvals can take days)
- [ ] **Meta VR Start program membership.** Apply from the competition page ("If you're not already a member of the Start program, apply now"). It's required *by the time of submission*. Use the same Meta developer account you already have.
- [ ] **Join the hackathon** on https://start-developer-competition-26.devpost.com/ ("Join hackathon").

## 2. Turn on the Lantern (story mode)
Until this is done, stories are told by the offline understudy.
- [ ] Vercel → **Add New → Project → Import** `pswapnajit/shadowplay`. Keep the detected Vite settings.
- [ ] Add the environment variable **`ANTHROPIC_API_KEY`** (Production), then **Deploy**.
- [ ] In the Anthropic Console, set a **monthly spend limit** on the key (about $50 is plenty; one story costs a few cents).
- [ ] Tell Claude the deployment URL, or let it find the URL in the repo's GitHub deployments. Claude then sets `STORY_API_FOR_PAGES`, checks a live story end to end and pushes.

## 3. Video (to re-record with story mode)
The current `~/Desktop/shadowplay-demo.mp4` (1:54) predates story mode. Once the Lantern is live, Claude records a new cut in the IWER emulator with `?director&story`: the tutorial, then a real, unscripted Claude story answered by scripted hands, kept under 3 minutes. The rules say to *lead with the story and what makes the project distinct*, and to show real gameplay honestly.
- [ ] Upload the new video to **YouTube as Public** (Unlisted is *not* enough; the rules say publicly visible).
  - Title: `Shadowplay — a hand-shadow theatre with an AI storyteller, for Meta Quest (WebXR)`
  - Description: the tagline below plus the play link `https://pswapnajit.github.io/shadowplay/`
- [ ] Paste the YouTube URL into the form.

The footage comes from Meta's IWER Quest 3 emulator, which the rules allow ("via XR Simulator, or another equivalent emulator"), driven by scripted hand input. The end card says so, which keeps the video honest.

## 4. The form (copy from `submission/DEVPOST.md`)
| Field | Value |
|---|---|
| Name | Shadowplay |
| Tagline | A lantern tells a story on your real wall, and your bare hands cast it: shape a shadow and that creature walks into the tale. |
| Track | Gaming |
| Division | New Experience |
| Project link | https://pswapnajit.github.io/shadowplay/ |
| Code | https://github.com/pswapnajit/shadowplay |
| Built with | Immersive Web SDK, WebXR, three.js, TypeScript, Web Audio, Claude, Vercel, MediaPipe |
| Description | the "Inspiration … What's next" sections of DEVPOST.md |
| Hand interactions | the "Hand interactions" section of DEVPOST.md |
| Target launch date | January 2027 |
| Images | upload `submission/gallery/*.jpg` (add story-mode stills after the new recording) |

**Prizes it's built for** (one prize per entry): Best New Gaming Experience. Special awards: Best Agentic Interaction (the Lantern), Best First Five Minutes (ghost-hand tutorial straight into a live story), Best Reason to Come Back (a new story every night, the Book of Shadows, the growing menagerie), Boldest Original Concept (it only works with your real hands in front of your real wall). If the form asks which special awards to consider, tick those.

**The "take it away" test** (from the rules): without Claude, Shadowplay still works fully. The theatre, matching, creatures and lessons are built on-device, and the offline understudy tells the stories. DEVPOST.md says so explicitly.

## 5. Before you press Submit
- [ ] Open the project link once in a desktop browser to confirm it loads, then press *Try with your webcam* and check that a story starts after the first creature.
- [ ] Keep the GitHub Pages site and the Vercel project (and the API key) up until winners are announced (~Dec 11). Pages deploys on every push to `main`.
