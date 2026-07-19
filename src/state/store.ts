/**
 * Zustand store per SPECS.md §5 — the ONLY bridge between the sim/Pixi world
 * and React. React components may select anything EXCEPT `multiplier`, which
 * is transient: TremorGame writes it every frame and Pixi systems read it via
 * `getState()`/`subscribe` — never through hooks.
 */
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { HISTORY_LENGTH, STARTING_BALANCE } from "../sim/constants";
import { createEngine, type TremorEngine } from "../sim/engine";
import { LocalSeededProvider } from "../sim/outcome";
import type { BetSlot, RoundPhase, RoundResult, RoundSpec } from "../sim/types";

export interface TremorStore {
  // ---- React-facing (changes a few times per round) ----
  balance: number;
  phase: RoundPhase;
  phaseEndsAt: number | null;
  bets: [BetSlot, BetSlot];
  history: RoundResult[];
  settings: { reducedMotion: boolean; muted: boolean };

  // ---- transient (NEVER selected by React components) ----
  multiplier: number;

  // ---- actions ----
  placeBet(slot: 0 | 1, amount: number, autoCashout: number | null): void;
  cashout(slot: 0 | 1): void;
  setSetting<K extends keyof TremorStore["settings"]>(k: K, v: TremorStore["settings"][K]): void;
}

/**
 * Factory so tests can wire a store to their own seeded engine; the app uses
 * the singletons below. The store mirrors engine state on engine events —
 * the engine stays the single authority for wallet and bet slots.
 */
export function createTremorStore(
  engine: TremorEngine,
  initialSettings?: Partial<TremorStore["settings"]>,
) {
  const store = create<TremorStore>()(
    subscribeWithSelector((set) => ({
      balance: engine.balance(),
      phase: "betting" as RoundPhase,
      phaseEndsAt: null,
      bets: engine.bets(),
      history: [],
      settings: { reducedMotion: false, muted: false, ...initialSettings },
      multiplier: 1,
      placeBet: (slot, amount, autoCashout) => engine.placeBet(slot, amount, autoCashout),
      cashout: (slot) => engine.requestCashout(slot),
      setSetting: (k, v) => set((s) => ({ settings: { ...s.settings, [k]: v } })),
    })),
  );

  let currentSpec: RoundSpec | null = null;

  const syncFromEngine = () => {
    store.setState({ balance: engine.balance(), bets: engine.bets() });
  };

  engine.on((event) => {
    switch (event.type) {
      case "phaseChanged":
        store.setState({ phase: event.phase, phaseEndsAt: event.endsAt });
        syncFromEngine();
        break;
      case "roundStarted":
        currentSpec = event.spec;
        break;
      case "crashed": {
        const result: RoundResult = {
          roundId: event.roundId,
          crashPoint: event.crashPoint,
          seed: currentSpec?.seed ?? "",
          nonce: currentSpec?.nonce ?? 0,
          endedAt: Date.now(),
        };
        store.setState((s) => ({ history: [result, ...s.history].slice(0, HISTORY_LENGTH) }));
        syncFromEngine();
        break;
      }
      case "cashedOut":
      case "betAccepted":
        syncFromEngine();
        break;
      case "betRejected":
        // Surfaced as UI feedback in M2; the bet panel disables invalid input.
        break;
    }
  });

  return store;
}

/** Demo client seed — labels the session's provably-fair stream, shown in verify UI. */
function sessionSeed(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const prefersReducedMotion =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

export const engine = createEngine({
  provider: new LocalSeededProvider(sessionSeed()),
  initialBalance: STARTING_BALANCE,
});

export const useTremorStore = createTremorStore(engine, {
  reducedMotion: prefersReducedMotion,
});
