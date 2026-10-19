# Demo video — Shadowplay (target 2:30, hard limit 3:00)

Rules: under 3 minutes, YouTube or Vimeo, public. Footage must show the project "as viewed on a Meta VR device, via XR Simulator, or another equivalent emulator". Show real gameplay, and don't lean on AI-generated video.

## How to record without a headset (real hands in the official emulator)

1. In the project folder: `npm run dev` (starts the IWSDK dev server with the IWER emulator).
2. In Chrome, open the local URL it prints (https://localhost:8081), accept the local certificate, and allow the camera.
3. Click **Try with your webcam**: your real hands now drive the shadows.
4. Click the emulator's **Enter XR** button: you're in the emulated Quest 3 mixed-reality room, and your webcam hands still cast the shadows.
5. Record the browser window with QuickTime (File → New Screen Recording → record selected portion). Record several takes; edit in iMovie.
6. For close-ups of your real hands, a phone on a tripod behind your shoulder works well (optional B-roll).

Tip: clear progress between takes from the browser console with `localStorage.clear()`, then reload.

## Shot list and voice-over

| Time | Picture | Voice-over / caption |
|---|---|---|
| 0:00–0:08 | Black. A small warm light appears, glides over the shoulder; the wall lights up. | "Everyone has made a shadow rabbit on a bedroom wall." |
| 0:08–0:20 | Title on the wall: *Shadowplay*. Room dims. | "Shadowplay turns your real wall into a shadow theatre. A lantern glows over your shoulder; your hands do the rest." |
| 0:20–0:45 | Golden ghost hand shows the Chatterbird; the player copies it; outline glows; flash; the bird wakes and chirps. | "A ghost hand shows you the shape. Match the outline… and the shadow wakes up." |
| 0:45–1:05 | Player opens and closes the beak; chirps. Then the dog: thumb ear, bark on jaw drop. | "Some shadows talk back. Open the beak, it chirps. Drop the jaw, it barks." |
| 1:05–1:30 | Rabbit hops away to the shelf; the swan glides; the menagerie row at the bottom of the light. | "Every creature you wake joins your menagerie, and it's still there tomorrow." |
| 1:30–1:50 | Move hand towards the lantern (shadow grows and softens), then towards the wall (shrinks, sharpens). | "It's real shadow physics: closer to the lantern, bigger and softer; closer to the wall, smaller and sharper." |
| 1:50–2:10 | Two-hand crocodile snapping; butterfly fluttering. | "Two hands make crocodiles and butterflies." |
| 2:10–2:25 | Thumbs-up skip; caption "Seated · hands only · no controllers · adaptive assist". | "It's seated, hands-only, and it eases off if you're close but stuck." |
| 2:25–2:35 | Free play: quick shapes summoning creatures; end card with the URL. | "Shadowplay. Open the link on your Quest and make something come alive." |

End card: **Shadowplay** · pswapnajit.github.io/shadowplay · Built with Meta's Immersive Web SDK
