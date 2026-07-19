import seedrandom from "seedrandom";
import { HOUSE_EDGE } from "./constants";
import type { RoundSpec } from "./types";

/**
 * The OutcomeProvider seam per SPECS.md §4 — the exact surface a WebSocket
 * server authority replaces in M8. The engine must not care which
 * implementation it has.
 */
export interface OutcomeProvider {
  nextRound(): Promise<RoundSpec>;
  /** Engine reports progress each tick; the provider decides when the crash fires. */
  tick(roundId: string, elapsedMs: number, multiplier: number): void;
  onCrash(cb: (roundId: string, crashPoint: number) => void): void;
  /** Resolves on the NEXT microtask minimum, even locally (rehearses network latency). */
  requestCashout(roundId: string, slot: 0 | 1): Promise<{ multiplier: number }>;
}

/**
 * Bustabit-style crash math. r ∈ [0,1). P(m ≥ X) ≈ (1 − HOUSE_EDGE)/X;
 * median ≈ 1.98x. Note P(crash == 1.00x) ≈ 0.0198: the explicit HOUSE_EDGE
 * band plus the r < ~0.0198 region where the formula floors to 1.00.
 */
export function crashPointFromUniform(r: number): number {
  if (r < HOUSE_EDGE) return 1.0;
  return Math.floor((100 * (1 - HOUSE_EDGE)) / (1 - r)) / 100; // 2 decimals
}

/**
 * Outcome RNG stream — sacred, isolated. Never used for cosmetics.
 */
export function outcomeRngForRound(seed: string, nonce: number): () => number {
  return seedrandom(`${seed}:${nonce}`);
}

/**
 * Cosmetic RNG stream (radar blip jitter, particle spawns). May never
 * influence the outcome, and the outcome may never influence it beyond the
 * shared multiplier value (golden rule #1).
 */
export function fxRngForRound(seed: string, nonce: number): () => number {
  return seedrandom(`${seed}:${nonce}:fx`);
}

/** Deterministic replay of a round's crash point — the provably-fair kernel. */
export function crashPointForRound(seed: string, nonce: number): number {
  return crashPointFromUniform(outcomeRngForRound(seed, nonce)());
}

const floor2 = (x: number): number => Math.floor(x * 100) / 100;

interface ActiveRound {
  roundId: string;
  crashPoint: number;
  lastMultiplier: number;
  crashed: boolean;
}

/**
 * Client-simulated outcomes for the frontend demo. Computes the crash point
 * up front in `nextRound` and fires `onCrash` from its own `tick` when the
 * reported multiplier reaches it.
 */
export class LocalSeededProvider implements OutcomeProvider {
  private active: ActiveRound | null = null;
  private nonce: number;
  private readonly crashCbs: Array<(roundId: string, crashPoint: number) => void> = [];

  constructor(
    private readonly seed: string,
    startNonce = 0,
  ) {
    this.nonce = startNonce;
  }

  nextRound(): Promise<RoundSpec> {
    this.nonce += 1;
    const nonce = this.nonce;
    this.active = {
      roundId: `r${nonce}`,
      crashPoint: crashPointForRound(this.seed, nonce),
      lastMultiplier: 1,
      crashed: false,
    };
    return Promise.resolve({ roundId: this.active.roundId, seed: this.seed, nonce });
  }

  tick(roundId: string, _elapsedMs: number, multiplier: number): void {
    const round = this.active;
    if (!round || round.roundId !== roundId || round.crashed) return;
    round.lastMultiplier = multiplier;
    if (multiplier >= round.crashPoint) {
      round.crashed = true;
      for (const cb of this.crashCbs) cb(roundId, round.crashPoint);
    }
  }

  onCrash(cb: (roundId: string, crashPoint: number) => void): void {
    this.crashCbs.push(cb);
  }

  async requestCashout(roundId: string, _slot: 0 | 1): Promise<{ multiplier: number }> {
    const round = this.active;
    if (!round || round.roundId !== roundId || round.crashed) {
      throw new Error("cashout rejected: round is not live");
    }
    // Captured at request time; settles at the current multiplier, floored to
    // 2 decimals, never above the crash point.
    const multiplier = floor2(Math.min(round.lastMultiplier, round.crashPoint));
    await Promise.resolve(); // never settle synchronously — rehearses M8 latency
    return { multiplier };
  }
}
