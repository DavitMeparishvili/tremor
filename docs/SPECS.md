# TREMOR — Technical Contracts

The shapes where modules meet. [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) says *what and why*; this file says *exactly what types cross module boundaries*, so parts built in different sessions snap together. If an implementation needs to deviate from a contract here, update this file in the same change.

---

## 1. Tuning constants (`sim/constants.ts`)

Single source — no magic numbers in systems.

| Constant | Value | Notes |
|---|---|---|
| `HOUSE_EDGE` | `0.01` | 1%; P(instant bust at 1.00x) |
| `CURVE_K` | `0.00006` | per ms; `m(t) = e^(K·t)` → 2x ≈ 11.5s |
| `BETTING_MS` | `6000` | revisit after M2 playtest |
| `ARMING_MS` | `800` | |
| `CRASHED_MS` | `2500` | hard budget — eruption timeline fits this, never the reverse |
| `SETTLING_MS` | `1500` | |
| `MAX_BET_SLOTS` | `2` | |
| `THUMP_BPM` | `60` | rhythm anchor: shake pulses, audio stems, crawler cycle |
| `SHAKE_MAX_PX` | `6` | at 1080p reference; scale with renderer height |
| `PARTICLES_STEADY_MAX` | `3000` | APEX band |
| `PARTICLES_BURST_MAX` | `8000` | eruption only |
| `HISTORY_LENGTH` | `20` | rounds kept for history bar |

## 2. Core sim types (`sim/types.ts`)

```ts
export type RoundPhase = "betting" | "arming" | "running" | "crashed" | "settling";

export interface RoundSpec {
  roundId: string;
  seed: string;        // shown in verify-round UI
  nonce: number;
}

export interface RoundResult {
  roundId: string;
  crashPoint: number;  // 2 decimals
  seed: string;
  nonce: number;
  endedAt: number;     // epoch ms
}

export interface BetSlot {
  slot: 0 | 1;
  state: "idle" | "placed" | "live" | "cashingOut" | "cashedOut" | "busted";
  amount: number;
  autoCashout: number | null;   // multiplier target, null = manual
  cashedOutAt: number | null;   // multiplier actually settled at
  payout: number | null;
}

export type EngineEvent =
  | { type: "phaseChanged"; phase: RoundPhase; endsAt: number | null } // endsAt null while "running"
  | { type: "roundStarted"; spec: RoundSpec }
  | { type: "crashed"; roundId: string; crashPoint: number }
  | { type: "cashedOut"; slot: 0 | 1; multiplier: number; payout: number }
  | { type: "betAccepted"; slot: 0 | 1; amount: number }
  | { type: "betRejected"; slot: 0 | 1; reason: "phase" | "balance" | "limit" };
```

## 3. Engine surface (`sim/engine.ts`)

```ts
export interface TremorEngine {
  /** Called every frame from the Pixi ticker with performance.now(). Drives ALL time. */
  tick(nowMs: number): void;
  /** Pure read; valid only during "running", else returns last/1.00. */
  currentMultiplier(): number;
  placeBet(slot: 0 | 1, amount: number, autoCashout: number | null): void;
  requestCashout(slot: 0 | 1): void;
  on(listener: (e: EngineEvent) => void): () => void;   // returns unsubscribe
}
```

Rules the engine guarantees:
- No `setTimeout`/`setInterval` — every transition derives from `tick(nowMs)` timestamps, so a throttled tab fast-forwards correctly on the next tick.
- `sim/` imports nothing from `pixi.js`, `react`, or `state/` — pure TS, unit-testable headless.
- Auto-cashout resolves in `tick` *before* the crash check when both trigger in the same frame at the same multiplier (player-favorable tie-break, matches genre convention).

## 4. Outcome provider (`sim/outcome.ts`)

```ts
export interface OutcomeProvider {
  nextRound(): Promise<RoundSpec>;
  /** Engine reports progress each tick; the provider decides when the crash fires. */
  tick(roundId: string, elapsedMs: number, multiplier: number): void;
  onCrash(cb: (roundId: string, crashPoint: number) => void): void;
  /** Resolves on the NEXT microtask minimum, even locally (rehearses network latency). */
  requestCashout(roundId: string, slot: 0 | 1): Promise<{ multiplier: number }>;
}
```

- `LocalSeededProvider` (now): computes `crashPoint` in `nextRound` via `seedrandom(seed + ":" + nonce)`, fires `onCrash` from its own `tick` when `multiplier >= crashPoint`.
- `RemoteProvider` (M8): ignores `tick` progress, fires `onCrash`/resolves cashouts from WebSocket messages. **The engine must not care which one it has.**
- Two RNG streams: `seedrandom(seed:nonce)` → outcome only; `seedrandom(seed:nonce:"fx")` → cosmetics only. Neither may leak into the other's consumers.

## 5. Store shape (`state/store.ts`, Zustand + `subscribeWithSelector`)

```ts
interface TremorStore {
  // ---- React-facing (changes a few times per round) ----
  balance: number;
  phase: RoundPhase;
  phaseEndsAt: number | null;
  bets: [BetSlot, BetSlot];
  history: RoundResult[];
  settings: { reducedMotion: boolean; muted: boolean };

  // ---- transient (NEVER selected by React components) ----
  multiplier: number;   // written every frame; Pixi reads via getState()/subscribe

  // ---- actions ----
  placeBet(slot: 0 | 1, amount: number, autoCashout: number | null): void;
  cashout(slot: 0 | 1): void;
  setSetting<K extends keyof TremorStore["settings"]>(k: K, v: TremorStore["settings"][K]): void;
}
```

Enforcement: React components may select anything **except** `multiplier`. Pixi systems read via `useStore.getState()` inside the ticker or `useStore.subscribe(sel, cb)` — never through hooks.

## 6. Tension contract (`game/systems/TensionDirector.ts`)

The **only** input theatrical systems receive. Note what's absent: the crash point.

```ts
export type TensionBand = "CALM" | "STIRRING" | "HUNTED" | "FRENZY" | "APEX";
export type StemName =
  | "machinery" | "heartbeat" | "bassRumble" | "klaxon" | "subDrone";

export interface TensionOutput {
  band: TensionBand;
  intensity: number;          // min(1, log(m)/log(20)), continuous 0..1
  pingRate: number;           // radar pings/sec
  shakePeak: number;          // px, ≤ SHAKE_MAX_PX, 0 if reducedMotion
  sandLevel: number;          // 0..1 spawn-rate multiplier
  thumpIntervalMs: number;    // 60000 / THUMP_BPM (may quicken at HUNTED+)
  audioMix: Record<StemName, number>; // target volumes 0..1; AudioDirector ramps toward these
}

// evaluate(multiplier: number, elapsedMs: number, fxRng: () => number): TensionOutput
```

Band thresholds: CALM <1.5, STIRRING <3, HUNTED <7, FRENZY <15, APEX ≥15. The full behavior table lives in IMPLEMENTATION_PLAN.md §4.4.

**Purity test (required in the vitest suite):** recording `TensionOutput` per frame for a round crashing at 50x, truncated at m=1.2, must deep-equal the recording of a round crashing at 1.2x with the same fx seed.

## 7. Pixi layer hierarchy (`game/layers.ts`)

```
app.stage
├─ world        ← ShakeSystem offsets THIS container only; unifier ColorMatrixFilter here
│   ├─ sky
│   ├─ dunesFar / dunesMid / dunesNear   (parallax)
│   ├─ crawler                            (Crawler entity)
│   ├─ worm                               (hidden until crash)
│   └─ sand                               (ParticleContainer — explicit boundsArea, position dynamic)
├─ fx           ← screen flash, shockwave ring (shakes? NO — sibling of world)
└─ hud          ← multiplier BitmapText, radar, crashed banner — NEVER shakes
```

## 8. Conventions

- **Naming:** entities `PascalCase.ts` (class per file); systems end in `System.ts` except `TensionDirector`/`AudioDirector`; sim files lowercase.
- **Events over imports:** Pixi systems react to `EngineEvent`s and store subscriptions; systems never call each other directly (TensionDirector output is the one shared read).
- **Assets:** manifest in `src/assets/manifest.ts`; bundles `boot` (dunes, crawler, UI atlas, fonts) and `deferred` (worm, audio stems, eruption FX) — `deferred` loads during the first BETTING phase.
- **Audio files:** `audio/stems/<stemName>.webm` + `.mp3` fallback, loops crossfaded seamless, all rhythmic stems at `THUMP_BPM`.
- **Tests:** everything in `sim/` has vitest coverage (distribution sanity, seed-replay determinism, phase timing, cashout math, tie-break rule) plus the §6 purity test. `game/` and `ui/` are verified by playing.
- **TypeScript:** `strict: true`; no `any` in `sim/` or contract surfaces.
