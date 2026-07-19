# TREMOR

A crash game (Bustabit/Aviator genre) with a sci-fi twist: an industrial crawler harvests minerals on a desert planet; the multiplier climbs until a colossal subterranean worm erupts and swallows it. **Frontend-only simulation for now** — outcomes are client-simulated behind a provider seam; a server authority replaces the seam later (milestone M8).

## Doc map — read before implementing

| Doc | Contains |
|---|---|
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Architecture, crash math, tension design, milestones M0–M8 with done-conditions |
| [docs/SPECS.md](docs/SPECS.md) | **Binding contracts**: types, engine/provider/store/tension interfaces, constants, layer hierarchy, conventions. Deviations must update SPECS.md in the same change. |
| [docs/ART_AUDIO_DIRECTION.md](docs/ART_AUDIO_DIRECTION.md) | Palette, lighting rule, asset sourcing (free/AI), audio stem list |

Work proceeds milestone-by-milestone per the plan. When starting work, identify which milestone it belongs to and check that milestone's done-condition before calling it complete.

## Golden rules (violations are bugs, even if the code works)

1. **Theater never knows the outcome.** Radar, shake, sand, and audio derive only from `(currentMultiplier, elapsed, fxRng)` — never from the crash point. Outcome RNG and cosmetic RNG are separate seeded streams.
2. **`sim/` is pure.** No imports from `pixi.js`, `react`, or `state/`. All timing from `tick(nowMs)` timestamps — no `setTimeout` for game phases.
3. **React never sees per-frame data.** The `multiplier` store field is transient: Pixi reads it via `getState()`/`subscribe`; React components must not select it. The big multiplier is Pixi `BitmapText`, not DOM.
4. **Only the `world` container shakes.** `hud` and `fx` are siblings and never move. Shake respects `settings.reducedMotion`.
5. **The backend seam stays clean.** If a change would force M8 (remote provider) to touch `game/` or `ui/`, the change is wrong — fix the abstraction instead.

## Tech stack

Vite + TypeScript (strict) · PixiJS v8 (game world) · React 18 + Tailwind (HUD only) · Zustand with `subscribeWithSelector` · seedrandom · Howler.js (audio stems) · GSAP (eruption timeline) · Vitest (`sim/` is fully tested).

**PixiJS v8 skills are installed in `.claude/skills/`** — consult the relevant skill (ticker, particle-container, assets, filters, …) before writing PixiJS code; v8 differs sharply from v7 and the skills document the correct current APIs.

## Commands

- `npm run dev` — Vite dev server (default http://localhost:5173)
- `npm run build` — typecheck (`tsc -b`) + production build
- `npm run test` — Vitest, single run (passes with no test files until M1)
- `npm run preview` — serve the production build
