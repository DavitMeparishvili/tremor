# TREMOR — Art & Audio Direction

Companion to [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md). How to source visuals and audio from free libraries and AI generators, and how to make mixed-origin assets look and sound like one game.

---

## 1. Lock the direction before sourcing anything

The #1 failure mode of free/AI asset pipelines is incoherence: ten great assets in ten styles look worse than ten mediocre assets in one style. So the first deliverable is not an asset — it's a one-page art bible:

**Three-word brief:** *industrial desert dread.*
Mood references: Dune (2021) sand + scale, heavy rust-tech machinery (Borderlands/Deep Rock vibes without the cartoon outlines), radar/submarine-thriller UI.

### Palette (lock it, everything must pass through it)

| Role | Hex | Usage |
|---|---|---|
| Sand light | `#E0B36A` | dune highlights, dust particles |
| Sand shadow | `#8A5A33` | dune shadow side, depth layers |
| Dusk haze | `#F2C89B → #C96B4A` | sky gradient |
| Machine hull | `#4A4E57` | crawler body |
| Rust accent | `#A4472A` | crawler details, worn edges |
| HUD teal | `#35E0C8` | radar, multiplier, cashout — **HUD only** |
| Danger red | `#FF4433` | alarms, crash state — HUD + APEX-band world accents |

**Separation rule:** HUD colors never appear in the world art; world colors never in the HUD. This is what keeps the multiplier and radar readable through maximum sand chaos.

**Lighting rule for all sprite art:** single hot key light from upper-left, long shadows to lower-right. Write it into every AI prompt; reject free assets that fight it (or flip/re-grade them).

**Fonts (free, OFL, Google Fonts):** *Chakra Petch* or *Orbitron* for the multiplier and numbers (techy, tabular-feeling digits — render as Pixi `BitmapText`); *Inter* for body UI.

---

## 2. The actual asset list is shorter than you think

Much of Tremor is **code-drawn**, not asset art: the radar (Pixi `Graphics` sweep + fading trail), the shockwave ring, screen flash, ground-crack glow, and all particles. Particles need only 2–3 tiny grayscale textures (soft 16px dot, hard sand grain, small rock chunk) — **runtime `tint` does the coloring**, so one white blob becomes dust, sparks, and debris.

The real art list, by milestone:

| Asset | Pieces | Source fit |
|---|---|---|
| Sky backdrop (M3) | 1 gradient image (or pure code gradient) | AI ✔ / code |
| Dune parallax (M3) | 3–4 horizontal layers, seamless-tileable | AI ✔ (see slicing recipe) |
| Crawler (M3) | body, treads, drill arm, cargo pod — **as separate layers** | AI + cutout cleanup |
| Worm (M5) | head + jaw + 3–5 body segments — **as separate pieces** | AI + cutout cleanup |
| Particles (M4) | 2–3 grayscale blobs | Kenney CC0 or 5 min in any editor |
| UI panels/buttons | none — Tailwind/CSS in the DOM HUD | free |
| Icons (settings, mute, history) | ~6 | game-icons.net or Kenney CC0 |

**The load-bearing trick — piece-based animation:** AI is bad at spritesheet animation (frames drift off-model) but great at single renders. So never ask AI for animation. Generate (or cut) the crawler and worm into parts, and animate the *parts* in code — treads scroll via `TilingSprite`, drill arm bobs on a sine, worm segments follow-the-leader behind the head with GSAP driving the eruption arc. Add particles on top. This sidesteps AI's biggest weakness entirely, and it's already how the implementation plan structures `Crawler.ts` and `Worm.ts`.

---

## 3. Free asset sources (with license reality-check)

**Visual**
- **Kenney.nl** — huge CC0 packs; best for particles, UI, icons. Zero-risk license.
- **OpenGameArt.org** — filter by CC0; quality varies wildly, good for particles/textures.
- **itch.io** free asset packs — often excellent desert/sci-fi tilesets; license is per-pack, read each one.
- **game-icons.net** — 4000+ icons, CC-BY (attribution required).
- **ambientCG / Poly Haven** — CC0 textures (sand, metal) for texturing generated art.

**Audio**
- **Sonniss GDC bundles** — tens of GB of professional SFX, royalty-free for commercial use; best free SFX source that exists.
- **freesound.org** — filter to CC0; great for organic material (sand movement, rock debris, metal stress).
- **Kenney audio packs** — CC0 UI clicks and stings.
- **Pixabay audio** — royalty-free loops and SFX, no attribution.

**License rules for this project:**
1. Prefer **CC0** > royalty-free > **CC-BY** (track attributions) — in that order.
2. **Avoid NC (non-commercial) and SA (share-alike)** entirely: this is a gambling product heading toward commercial use, and SA can contaminate your asset pipeline.
3. Keep `docs/CREDITS.md` from day one: source URL, author, license, for every non-CC0 asset. Retrofitting this later is miserable.

---

## 4. AI-generated visuals — what works, what doesn't, and the pipeline

**Works well:** backdrops, parallax layers, single-object renders (crawler body, worm head), surface textures, concept/mood art, marketing images.
**Works poorly:** frame-by-frame animation, exact consistency across separate generations, clean transparent backgrounds (always needs cutout cleanup), any text inside images.

**Tools:** Midjourney (best quality/coherence; paid plans include commercial rights), Flux (via fal.ai/Replicate), Stable Diffusion XL (free, local, most controllable via img2img/LoRA), Retro Diffusion (if you ever pivot to pixel art), Photoshop Generative Fill (seam repair, layer extension — the unsung hero of the slicing recipe).

### The pipeline

1. **Mood board first (10–15 generations), pick ONE anchor image.** Every subsequent generation uses the anchor as a style/image reference. Do not skip this — the anchor is your consistency mechanism.
2. **Fixed style suffix, reused verbatim in every prompt.** E.g.: `"heavy industrial sci-fi machine, orange desert at dusk, painterly matte-painting style, muted palette, hot key light upper-left, long shadows, side view, game asset, no text"`. Vary only the subject clause, never the suffix.
3. **Parallax recipe:** generate one wide desert vista → slice into fore/mid/background layers yourself → fill the holes behind each cut with Generative Fill → make the far layers seamlessly tileable (offset-and-heal). One good generation yields the entire M3 background.
4. **Sprite recipe:** prompt for `"...isolated on flat neutral gray background, full side view"` → cut out with rembg/BiRefNet or Photoshop → then **cut into parts** along natural seams (tread line, arm joint, worm segment rings) and heal the overlaps, so code can animate the pieces (§2).
5. **The unifier pass (this is what makes it all cohere):** batch color-grade every finished asset to the §1 palette — a shared LUT/adjustment in your editor, or cheaper: a subtle `ColorMatrixFilter`/adjustment applied to the whole `world` container in Pixi so every asset passes through the same grade at runtime. Mixed Kenney + Midjourney + hand-made assets come out the other side looking like one game.

---

## 5. Audio — free + AI, built as *stems*, never as a song

The tension system (implementation plan §4.4) needs **independent volume control per layer**, so you must source audio as separate loopable stems, not one mixed track. Never generate "tense desert music" as a single song — you can't ramp its layers.

### The stem list (maps 1:1 to the tension table)

| Stem | Type | Band it enters | Source suggestion |
|---|---|---|---|
| Machinery loop | loop | CALM | Sonniss / freesound (engine, factory) |
| Harvest thump | one-shot | CALM (rhythm anchor) | freesound (impact) + pitch down |
| Heartbeat loop | loop | STIRRING | AI or freesound |
| Bass rumble | loop | HUNTED | AI drone (see below) |
| Klaxon (low, distant) | loop | FRENZY | freesound + heavy filter |
| Sub-bass dread drone | loop | APEX | AI drone |
| Eruption roar | one-shot | crash | layered: freesound (rock slide + animal roar pitched down + sub drop) |
| Pod launch sting | one-shot | cashout | Kenney/ElevenLabs |
| Win sting / UI clicks | one-shots | — | Kenney CC0 |

### AI audio tools

- **ElevenLabs SFX generator** — genuinely good for one-shots ("massive creature roar underground", "hydraulic pod launch"). Fastest path for bespoke SFX.
- **Suno / Udio / Stable Audio** — for the musical stems. The trick: prompt for **one layer at a time**, e.g. `"60 BPM, sub-bass drone only, no melody, no percussion, dark, seamless loop"` then `"60 BPM, heartbeat kick pattern only, no other instruments"`. Commercial rights require paid tiers on Suno/Udio — check before shipping.
- **Tempo rule:** every rhythmic stem at the same BPM (pick 60 — it's also the heartbeat rate), so stacked layers stay locked, and sync the ShakeSystem thump pulses to the same grid.

### Loop hygiene

Free/AI loops rarely loop cleanly. Fix in **Audacity or Reaper (free)**: crossfade the tail into the head (~100ms), export. Ship `webm` + `mp3` fallback for Howler. Normalize stems to a common LUFS so the TensionDirector's volume ramps behave predictably.

---

## 6. How to choose: the 5-question filter

Run every candidate asset (free or generated) through this before it enters the repo:

1. **Does it read at gameplay size?** Shrink to in-game scale, glance for 1 second. If you can't tell what it is, reject — no exceptions for "but it's beautiful zoomed in."
2. **Does it sit in the palette** — or can the unifier grade pull it in? (Test: drop it on the dune background screenshot.)
3. **Is the license compatible and recorded** in CREDITS.md? (CC0 / royalty-free / CC-BY only.)
4. **Can it be split into parts** for code animation, if it's a creature/machine?
5. **Does it match the lighting rule** (key light upper-left)?

**Process order:** mood board → anchor image → M2 plays with rectangles → placeholder pass with CC0 (Kenney particles, freesound loops) → replace piece-by-piece with anchored AI generations behind the unifier grade. Never block a milestone on final art — the placeholder tier *is* a milestone deliverable.
