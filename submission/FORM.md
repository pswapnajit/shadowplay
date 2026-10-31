# Devpost "additional info" form: answer for each field

**Email associated with your developer organization / Meta VR Start membership:** the email of the Meta account you create the developer organization with (use the same one for the Start application).

**Teammates:** leave blank (solo entry).

**Name of your Team or Organization:** `Swapnajit Patra` (shown as "Shadowplay created by Swapnajit Patra").

**Track:** Entertainment

**Division:** New

**For Adapted or Significantly Updated Experiences:** leave blank.

**Which Build Path did you utilize?:** Immersive Web SDK (WebXR). If the list words it differently, pick the WebXR / IWSDK option.

**URL link to your Meta VR competition release channel (WebXR: hosted URL):** `https://pswapnajit.github.io/shadowplay/`

**What Meta VR capability(ies) did you use in your project?**

```text
Hand tracking: all 25 joints of each hand (WebXR Hand Input) drive both the shadows and the matching, and nothing in the experience needs a controller.
Passthrough (mixed reality, immersive-ar): the player's real wall is the stage, and the rest of the room dims around the lantern's pool of light.
Scene understanding: plane detection finds the real wall the lantern's light would land on, and a paper screen stands in if there's none.
Head pose (gaze): "Look to choose" lets players with limited hand mobility play hands-free by looking at a creature or an outline.
Spatial audio: each creature is heard from its place on the wall, and the Lantern speaks from over the player's shoulder.
FoV-aware layout: all text and interaction stay within a band about 45° wide, comfortable on every Quest.
Built with the Immersive Web SDK, three.js and WebXR, running in Meta Quest Browser.
```

**Describe how Hand Interactions are implemented into your experience.**

```text
Shadowplay is hands-only from start to finish. Your hands are both the controller and the content, because the shadow is your hand.

- Each tracked joint is projected from the lantern onto the real wall as a capsule, so your shadow follows every finger, grows and softens as your hand nears the lantern, and sharpens near the wall.
- Casting and shaping a shadow (continuous hand and finger pose) teaches each of nine creatures. Shapes are matched by intersection-over-union across rotations and mirrors, so either hand works, and finger checks stop an open hand passing as a rabbit.
- In a story, the creature you make is the answer to the Lantern's ask: it walks into the tale, and making a different one bends the story.
- Mouth movements make creatures speak: thumb to index for the bird, the little finger for the dog's jaw, hands apart for the crocodile.
- A held thumbs-up lets an ask go, skips a lesson, or asks for another story.
- A golden ghost hand demonstrates any shape you haven't learned, so there's nothing to read.
- Everything fits within arm's reach while seated, and every hand action also has a gaze twin for players who can't use their hands.
```

**What makes you excited about the future of VR?** (about 110 words)

```text
The oldest interactions become new again when hand tracking meets your own room. Shadowplay is a hundred-year-old game, rabbits on a bedroom wall, and it works because the headset knows where every knuckle is and where your real wall is. What excites me is that these devices are becoming ordinary household objects, things you put on for ten minutes at bedtime and share with someone you love, even when they're far away. Add a storyteller that listens to what your hands do, and a toy becomes a ritual you come back to every night. I think the best VR will feel less like a screen and more like your own home, made a little magical.
```

**Target launch date:** January 2027

**Checkboxes:** tick them only when they're true. "I am a member of the Meta VR Start program" needs your Start membership approved first.
