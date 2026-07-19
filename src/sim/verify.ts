/**
 * Provably-fair scaffolding (plan §4.2): replay a round's crash point from
 * its public {seed, nonce}. The M7 "verify round" modal calls this; when the
 * M8 backend lands, only the kernel changes (HMAC of server/client seeds) —
 * the player-facing feature survives the swap.
 */
import { crashPointForRound } from "./outcome";
import type { RoundResult } from "./types";

/** Recompute the crash point a given seed+nonce must produce. */
export function verifyCrashPoint(seed: string, nonce: number): number {
  return crashPointForRound(seed, nonce);
}

/** True iff the recorded result matches its deterministic replay. */
export function verifyRoundResult(result: RoundResult): boolean {
  return verifyCrashPoint(result.seed, result.nonce) === result.crashPoint;
}
