/**
 * Core sim types per SPECS.md §2. `sim/` is pure TS: no pixi/react/state
 * imports anywhere in this directory.
 */

export type RoundPhase = "betting" | "arming" | "running" | "crashed" | "settling";

export interface RoundSpec {
  roundId: string;
  /** Shown in the verify-round UI. */
  seed: string;
  nonce: number;
}

export interface RoundResult {
  roundId: string;
  /** 2 decimals. */
  crashPoint: number;
  seed: string;
  nonce: number;
  /** Epoch ms. */
  endedAt: number;
}

export interface BetSlot {
  slot: 0 | 1;
  state: "idle" | "placed" | "live" | "cashingOut" | "cashedOut" | "busted";
  amount: number;
  /** Multiplier target, null = manual. */
  autoCashout: number | null;
  /** Multiplier actually settled at. */
  cashedOutAt: number | null;
  payout: number | null;
}

export type EngineEvent =
  | { type: "phaseChanged"; phase: RoundPhase; endsAt: number | null } // endsAt null while "running"
  | { type: "roundStarted"; spec: RoundSpec }
  | { type: "crashed"; roundId: string; crashPoint: number }
  | { type: "cashedOut"; slot: 0 | 1; multiplier: number; payout: number }
  | { type: "betAccepted"; slot: 0 | 1; amount: number }
  | { type: "betRejected"; slot: 0 | 1; reason: "phase" | "balance" | "limit" };
