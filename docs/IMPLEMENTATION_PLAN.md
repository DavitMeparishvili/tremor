# TREMOR — Frontend Implementation Plan

> Crash game, sci-fi/ecological theme: an industrial crawler harvests minerals on a desert planet while its rhythmic thumping attracts a colossal subterranean predator. The multiplier climbs until the creature erupts and swallows the harvester. Frontend-only simulation first; backend authority later.

---

## 1. Idea Analysis

### What works (keep and amplify)

- **The crash is diegetic.** In Aviator/JetX the plane "just leaves" — an arbitrary RNG event with a coat of paint. In Tremor the crash has a *cause* the player can see coming: the louder you harvest, the closer the worm gets. Risk is narrativized, which makes holding feel like a decision, not a dice roll.
- **Multi-channel tension escalation.** Most crash games have exactly one tension channel: the number going up. Tremor has four independent sensory channels that can all ramp — seismic radar (visual/informational), screen rumble (kinesthetic), sand/particle activity (ambient visual), and audio layers (heartbeat thump → bass rumble → alarm). Layered escalation is what makes it *feel* different, not just look different.
- **The crash moment is a payoff, not a punishment.** A worm eruption is spectacular. Players who bust still get a show — that softens the loss and keeps the loop fun to watch, which matters for session length.

### Critical design constraints (get these wrong and the game fails)

1. **Tension cues MUST derive only from the current multiplier — never from the hidden crash point.**
   This is the single most load-bearing rule in the whole design. If radar ping rate, shake amplitude, or worm proximity are driven by *when the round will actually crash*, one of two fatal things happens:
   - Players reverse-engineer the cues and gain an edge (breaks the game economically), or
   - Players *believe* the cues predict the crash when they don't (feels rigged when a "calm" round busts at 1.2x).

   Rule: every theatrical system is a pure function of `(currentMultiplier, elapsedTime, cosmetic-only RNG)`. The cosmetic RNG stream is separate from the outcome RNG. Radar "blips" are theater keyed to the multiplier band, with random noise on top. A round that will crash at 50x and a round that will crash at 1.5x must look **identical** at multiplier 1.4x.

2. **Round cadence is king.** Crash games live on fast loops: ~5s betting window, variable flight, ~3s crash/settle. The eruption animation is your signature moment but it cannot block the next round for more than ~2.5–3s. Design it as: eruption impact (0.6s, with hit-stop/slow-mo) → swallow + dust settle (1.5s) → results overlay while dunes reset behind it.

3. **The multiplier number stays king of the screen.** All the sand, shake, and worms are garnish. The multiplier must be huge, centered-or-near-centered, crisp at 60fps, and readable through maximum screen shake (i.e., the multiplier and HUD do **not** shake — only the world layer does).

4. **Motion comfort.** Constant screen shake for 30+ seconds is nauseating. Shake comes in *pulses* synced to the harvester's thump rhythm (this also reinforces the "rhythmic thumping attracts the worm" fiction), with amplitude capped (~6px at 1080p) and a "reduced motion" toggle from day one.

5. **Demo honesty.** Until a backend exists, outcomes are client-simulated. Label the build "DEMO / SIMULATED" — and architect so the sim is swappable (see §5).

---

## 2. Technology Stack

| Concern | Choice | Rationale |
|---|---|---|
| Build tool | **Vite + TypeScript** | Instant HMR; TS is non-negotiable for the sim math and state machine. |
| Game renderer | **PixiJS v8** (`pixi.js`) | WebGL/WebGPU with automatic fallback; `ParticleContainer` renders thousands of sand particles in one draw call. This repo already has the full PixiJS v8 skill set installed in `.claude/skills/` — consult them during implementation. |
| UI / HUD shell | **React 18 + Tailwind CSS** | Bet panel, history bar, modals, settings. React never touches the canvas contents. |
| State bridge | **Zustand** (with `subscribeWithSelector`) | Pixi systems read via `store.getState()` inside the ticker (no re-renders); React subscribes to low-frequency slices only. |
| Game loop | **Pixi `Ticker`** (app's own ticker) | v8 ticker passes the `Ticker` instance to callbacks; use `deltaMS` for time math. The multiplier itself is *not* integrated per-frame — it's a pure function of elapsed round time (§4.2), so it can never drift. |
| Outcome RNG | **`seedrandom`** behind an `OutcomeProvider` interface | Deterministic, seed-replayable rounds; the interface is the exact seam where a WebSocket-driven server authority plugs in later. |
| Audio | **Howler.js** | Layered loops with per-layer volume ramps, sprite support, mobile unlock handling. |
| Tweens/sequencing | **GSAP** | Eruption choreography (timeline with hit-stop, camera punch, slow-mo via `ticker.speed`). |
| Testing | **Vitest** | Pure-function tests for crash math, curve, state machine, and determinism (same seed → same round). |

**Explicitly avoided:** React state for anything that changes per frame; `@pixi/react` (unnecessary indirection for a game world this stateful); physics engines (nothing here needs one).

---

## 3. Architecture

### 3.1 The three-layer split

```
┌─────────────────────────────────────────────────────┐
│ React HUD (DOM, Tailwind)                           │  low-frequency: bets, balance,
│   BetPanel · RoundHistory · Settings · Modals       │  round phase, history
├─────────────────────────────────────────────────────┤
│ Zustand store  ←— the only bridge —→                │
├─────────────────────────────────────────────────────┤
│ Pixi World (canvas)                    60fps        │
│   Dunes · Crawler · Sand particles · Radar ·        │
│   Multiplier (BitmapText) · Worm · Screen shake     │
├─────────────────────────────────────────────────────┤
│ Sim Engine (pure TS, zero pixi/react imports)       │
│   Round state machine · Crash math · OutcomeProvider│
└─────────────────────────────────────────────────────┘
```

- **Sim engine** knows nothing about rendering. It is driven by `tick(nowMs)` and emits events (`phaseChanged`, `crashed`, `cashedOut`). This is the part the backend replaces later, so purity here is the whole ballgame.
- **The big multiplier is rendered in Pixi as `BitmapText`**, not React — it updates every frame and must never touch the DOM. React shows it only in the post-round results card.
- **Screen shake applies to a `worldContainer` offset only.** HUD layer (multiplier, radar frame) lives in a sibling container that never shakes.

### 3.2 Directory structure

```
src/
  main.tsx                 # React root + mounts TremorGame canvas
  App.tsx
  sim/                     # ← pure logic, no pixi/react imports, fully unit-tested
    types.ts               # RoundPhase, RoundResult, Bet, events
    curve.ts               # multiplier(t), timeToMultiplier(m)
    outcome.ts             # OutcomeProvider interface + LocalSeededProvider
    engine.ts              # round state machine (the heart)
    verify.ts              # round replay/verification from seed
  state/
    store.ts               # Zustand: wallet, bets, phase, history, settings
  game/                    # ← Pixi world, no React imports
    TremorGame.ts          # Application init, layer setup, ticker wiring
    layers.ts              # world / fx / hud container hierarchy
    entities/
      Crawler.ts           # harvester sprite, thump animation cycle
      Worm.ts              # eruption sequence (GSAP timeline)
      Dunes.ts             # parallax background, heat shimmer
    systems/
      SandSystem.ts        # ParticleContainer dust/geysers
      ShakeSystem.ts       # pulsed decay shake, honors reduced-motion
      RadarSystem.ts       # seismic radar rendering + ping scheduler
      TensionDirector.ts   # multiplier → intensity mapping (single source of truth)
      MultiplierDisplay.ts # BitmapText, per-frame update
  audio/
    AudioDirector.ts       # howler layers, ramps keyed by TensionDirector
  ui/                      # React HUD
    BetPanel.tsx           # two bet slots, quick chips, auto-cashout
    RoundHistory.tsx       # last-N crash multipliers bar
    ResultsToast.tsx       # win/bust card
    SettingsModal.tsx      # reduced motion, sound, verify-round
  assets/                  # manifest.ts + spritesheets/audio (Assets bundles)
```

### 3.3 Data flow per frame

```
app.ticker (Pixi, UPDATE_PRIORITY.HIGH)
  → engine.tick(performance.now())          // sim advances, maybe fires events
  → store transient write (multiplier)      // subscribeWithSelector, no React render
  → TensionDirector.evaluate(multiplier)    // computes intensity 0..1 + band
  → systems read director output:
      ShakeSystem, SandSystem, RadarSystem, AudioDirector, Crawler
  → MultiplierDisplay.text = format(m)
(render happens automatically at UPDATE_PRIORITY.LOW)
```

React components subscribe only to `phase`, `wallet`, `bets`, `history` — all of which change a few times per round, not per frame.

---

## 4. Game Design Spec

### 4.1 Round lifecycle (state machine)

```
BETTING (6s countdown)
   │  players place/adjust up to 2 bets; auto-cashout optional
   ▼
ARMING (0.8s)  — crawler deploys, drills spin up, radar boots (theater only)
   ▼
RUNNING        — multiplier climbs from 1.00x; cashout enabled per bet
   │  cashout → bet settles at current m, crawler ejects a cargo pod (visual reward)
   ▼
CRASHED (≈2.5s) — worm erupts, hit-stop, swallow, dust
   ▼
SETTLING (1.5s) — results card, history updates, dunes reset behind overlay
   ▼
back to BETTING
```

Implementation: a `phase` enum + `phaseStartedAt` timestamp in the engine; transitions are time-driven inside `tick()`. Every transition emits an event the store and Pixi listen to. **No `setTimeout` for game phases** — everything derives from the ticker clock so a background-tab stall can't desync phases.

### 4.2 Crash math (Bustabit-style, industry standard)

```ts
// outcome.ts — LocalSeededProvider
const HOUSE_EDGE = 0.01; // 1%

function crashPointFromUniform(r: number): number {
  // r ∈ [0,1). P(instant bust at 1.00x) = HOUSE_EDGE.
  if (r < HOUSE_EDGE) return 1.0;
  return Math.floor(100 * (1 - HOUSE_EDGE) / (1 - r)) / 100; // 2 decimals
}
```

Properties: median crash ≈ 1.98x, P(m ≥ X) ≈ 0.99/X, long-tail rounds (100x+) are rare but real. EV of cashing out at any target is `0.99 × stake` — the edge is uniform, so no cashout strategy is "smarter", which is exactly what you want.

**Multiplier curve** (exponential, matches genre feel):

```ts
// curve.ts
const K = 0.00006; // per ms → 2x at ~11.5s, 10x at ~38s
export const multiplierAt = (tMs: number) => Math.exp(K * tMs);
export const timeToMultiplier = (m: number) => Math.log(m) / K;
```

At round start the engine computes `crashPoint` (from the provider) and `tCrash = timeToMultiplier(crashPoint)` **once**. Each frame, `m = multiplierAt(now - runStartedAt)`; the round crashes when `elapsed ≥ tCrash`. The multiplier is a pure function of elapsed time — frame-rate independent, drift-free, and trivially replayable.

**Two RNG streams per round, both from `seedrandom`:**
- `outcomeRng(seed:roundNonce)` → crash point. Sacred, isolated.
- `fxRng(seed:roundNonce:"fx")` → cosmetic noise (radar blip jitter, particle spawns). May never influence outcome, and outcome may never influence it beyond the shared multiplier value.

**Provably-fair scaffolding now, cheaply:** store `{seed, nonce, crashPoint}` per round in history and ship a "verify round" button that replays `crashPointFromUniform(seedrandom(seed+nonce)())`. When the backend arrives, this same UI verifies `HMAC-SHA256(serverSeed, clientSeed:nonce)` instead — the player-facing feature survives the swap.

### 4.3 The OutcomeProvider seam (backend-readiness)

```ts
// The ONLY contract the engine knows. Backend swap = new implementation, zero engine changes.
export interface OutcomeProvider {
  /** Resolve before RUNNING starts. Local: instant. Remote: server round-start message. */
  nextRound(): Promise<RoundSpec>;   // { roundId, seedInfo }
  /** Local: precomputed tCrash check. Remote: authoritative crash push. */
  onCrash(cb: (roundId: string, crashPoint: number) => void): void;
  /** Local: instant at current m. Remote: server-acknowledged cashout multiplier. */
  requestCashout(betId: string): Promise<{ multiplier: number }>;
}
```

Design consequence to honor **now**: even the local provider resolves cashouts asynchronously (next microtask) and the UI shows an intermediate "cashing out…" flash of ≤100ms. That way the real network latency later doesn't change the UX contract, and you'll have already handled the "cashout requested at 2.00x, confirmed at 2.03x" display question.

### 4.4 Tension map — single source of truth

`TensionDirector` converts multiplier → a continuous `intensity ∈ [0,1]` (e.g. `min(1, log(m)/log(20))`) plus a discrete band. **Every** theatrical system keys off this one table:

| Band | Multiplier | Radar | Shake (pulse peak) | Sand | Audio |
|---|---|---|---|---|---|
| CALM | 1.00–1.5x | sweep only, ping ~0.4/s | 0–1px | drifting dust motes | machinery loop, soft thump |
| STIRRING | 1.5–3x | ping ~1/s, faint edge blip | 2px | ripples around treads | + low heartbeat layer |
| HUNTED | 3–7x | ping 2/s, blip visibly closing | 3–4px | dune surface crawls, small spouts | + bass rumble, thump quickens |
| FRENZY | 7–15x | ping 4/s, blip circling close | 5px | sand geysers, debris hops | + alarm klaxon (low), music thins |
| APEX | 15x+ | continuous return, radar red | 6px cap, faster pulses | ground cracks glow | heartbeat only + sub-bass — *drop layers instead of adding* |

Two deliberate tricks in that table:
- **APEX gets quieter, not louder.** Stripping audio layers at extreme multipliers ("the worm is listening") is scarier than more noise, and it gives the eruption impact contrast to land against.
- **Radar blips use `fxRng` noise.** At HUNTED, ~15% of pings render a "close" blip that recedes — near-miss theater. It's uncorrelated with the outcome (rule #1) but reads as "it almost got me", which is the addictive beat of the whole genre. Keep the frequency modest.

### 4.5 Retention mechanics (standard for the genre, cheap to build)

- **Two independent bet slots** with separate auto-cashout targets (hedge play: one at 1.5x, one rides).
- **Round history bar** — last ~20 crash multipliers, color-coded (<2x dim, ≥10x hot). This is the genre's strongest "one more round" hook.
- **Ghost line on bust:** "cashed out would have paid X at your auto target" — only when they had no auto-cashout set.
- **Cargo pod eject on cashout:** your harvester launches a glowing pod to safety while the crawler keeps drilling for remaining bettors — the win is visible *inside* the fiction.

---

## 5. Milestones

Each milestone ends in a runnable, demoable state.

### M0 — Scaffold (0.5 day)
Vite + React + TS + Tailwind + Pixi app boot. `Application` init (`await app.init({...})`, `resizeTo`), canvas mounted under React, layer containers (`world`/`fx`/`hud`), FPS readout. Placeholder `Graphics` rectangles for crawler/dunes.
**Done when:** hot-reloading canvas at 60fps with a shaking placeholder box on keypress.

### M1 — Sim engine + determinism (1–1.5 days)
`curve.ts`, `outcome.ts`, `engine.ts` state machine, Zustand store, wallet/bet logic. Vitest suite: crash distribution sanity (10⁶ samples: median ≈1.98, P(≥10x) ≈ 9.9%), same-seed replay equality, phase-transition timing, cashout settle math.
**Done when:** headless test drives 1000 full rounds; a debug text HUD shows live phases/multiplier in the canvas.

### M2 — Betting UI + core loop feel (1–1.5 days)
BetPanel (two slots, quick chips, auto-cashout), countdown, Pixi `BitmapText` multiplier display, cashout button state machine (idle → placed → live "CASH OUT @ m" → settled), round history bar, results toast.
**Done when:** the game is *playable* end-to-end with rectangles for art. This is the point to playtest cadence and tune phase durations.

### M3 — Desert world (1.5–2 days)
Parallax dune layers, crawler sprite with thumping harvest animation cycle (the rhythm everything syncs to), cargo pod eject on cashout, day-cycle tint drift for round variety. Asset pipeline: `Assets.init` with a manifest, background-load the `gameplay` bundle during BETTING.
**Done when:** the scene reads as "a machine harvesting a hostile desert" with no explanation needed.

### M4 — Tension systems (2 days)
`TensionDirector` + the three consumers:
- **ShakeSystem** — pulses synced to crawler thump; smoothed noise offset (not per-frame random jitter — use a decaying sine × noise so it feels like impacts, not vibration); world container only; reduced-motion honored.
- **SandSystem** — `ParticleContainer` (v8 `Particle` API: `addParticle`, `dynamicProperties: { position: true }`, explicit `boundsArea`); pooled particles; dust motes → ripples → geysers per band.
- **RadarSystem** — circular sweep (`Graphics` arc + fading trail), ping scheduler from the tension table, `fxRng` blip placement, near-miss blips.
**Done when:** with the multiplier number hidden, a viewer can guess the band within ±1 from feel alone.

### M5 — The eruption (1.5–2 days)
Worm crash sequence as a GSAP timeline: pre-tremor spike (0.2s) → breach (sand explosion via a burst on SandSystem, shockwave ring, screen flash) → hit-stop (`app.ticker.speed = 0.15` for ~180ms, then ramp back — cheap, spectacular slow-mo) → swallow → dust settle under the results overlay. Multiplier snaps to red `CRASHED @ Xx`.
**Done when:** busting feels like an event you'd screen-record, and the next betting window still opens on schedule.

### M6 — Audio (1 day)
Howler layer stack per the tension table; volume ramps driven by `TensionDirector` (never hard cuts); thump SFX sample-synced with ShakeSystem pulses; cashout "pod launch" sting; eruption impact with a pre-crash audio dropout (~150ms of near-silence before the roar — sells the hit).
**Done when:** the game works with eyes closed.

### M7 — Polish + hardening (1–2 days)
Mobile layout (portrait-first — real crash-game traffic is mobile), `document.visibilitychange` handling (engine keeps time via timestamps, world fast-forwards on return), reduced-motion + mute persistence, "verify round" modal, demo-mode banner, error boundaries, performance pass (§6).

### M8 — Backend integration (later, out of scope now — but the shape is fixed)
`RemoteOutcomeProvider` over WebSocket: server round-start (`roundId`, hashed seed), server crash push, server-acked cashouts, wallet moves server-side, client curve rendering unchanged (multiplier stays a function of server-anchored round start time + clock-offset estimate). The engine, all Pixi systems, and all React UI are untouched — only the provider and wallet source change. **Anything that makes M8 require touching `game/` or `ui/` is an M1–M7 architecture bug.**

Total estimate: **~10–13 focused days** to a polished frontend demo.

---

## 6. Performance Budgets

| Metric | Budget | Levers |
|---|---|---|
| Frame rate | 60fps mid-tier mobile, 120Hz-safe desktop | `deltaMS`-based everything; no per-frame allocations in systems (pool particles, reuse Points) |
| Draw calls | < 25 steady-state | One `ParticleContainer` for all sand; single spritesheet atlas for world sprites; `BitmapText` for multiplier |
| Particles | ≤ 3000 live (APEX), ≤ 8000 during eruption burst | Pooled; only `position` (+ `color` for fade) in `dynamicProperties` |
| GC pressure | No sawtooth in DevTools during RUNNING | Preallocate eruption timeline; no closures created per frame |
| Load | < 2.5s to first playable round on 4G | Bundle split: boot bundle (dunes, crawler, UI atlas) vs. deferred (worm frames, audio) loaded during first BETTING |

---

## 7. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| Theater accidentally correlates with outcome (players detect or *believe* a pattern) | Rule #1 enforced structurally: outcome RNG isolated in `outcome.ts`; `TensionDirector` receives only `(multiplier, elapsed, fxRng)`. Add a test: serialize FX-system inputs for a 1.2x round and a 50x round truncated at 1.2x — must be identical. |
| Shake-induced motion sickness | Pulsed shake, 6px cap, HUD never shakes, reduced-motion toggle in M4 (not deferred to polish). |
| Eruption slows round cadence | Hard 2.5s crash-phase budget enforced by the state machine, not by animation completion — the timeline is built to fit, never the reverse. |
| Tab throttling desyncs rounds | All timing from timestamps, never accumulated deltas; on visibility regain, engine `tick(now)` fast-forwards through any missed transitions. |
| Scope creep on art | M2 playable-with-rectangles gate: game feel is validated before any real art is commissioned. |

**Open questions to settle during M2 playtesting:**
1. Betting window: 6s feels standard; test 5s vs 8s with the two-slot UI.
2. Curve constant `K`: 0.00006/ms is genre-typical; a slightly faster early curve (piecewise K) makes low rounds snappier but complicates verify-round math — decide with real feel, keep the curve pure either way.
3. Radar placement: corner HUD widget vs. integrated into the crawler's dashboard art — test both mocks in M3.

---

*PixiJS v8 implementation reference: the `.claude/skills/pixijs-*` skill files in this repo document the exact v8 APIs (Application init, Ticker semantics, Particle API, Assets bundles, filters) and their common pitfalls — consult the relevant skill before implementing each system.*
