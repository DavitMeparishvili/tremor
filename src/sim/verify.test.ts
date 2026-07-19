import { describe, expect, it } from "vitest";
import { crashPointForRound } from "./outcome";
import { verifyCrashPoint, verifyRoundResult } from "./verify";
import type { RoundResult } from "./types";

describe("verify", () => {
  const result: RoundResult = {
    roundId: "r3",
    crashPoint: crashPointForRound("verify-seed", 3),
    seed: "verify-seed",
    nonce: 3,
    endedAt: 1_700_000_000_000,
  };

  it("replays the crash point from public seed + nonce", () => {
    expect(verifyCrashPoint("verify-seed", 3)).toBe(result.crashPoint);
  });

  it("accepts an honest result and flags a tampered one", () => {
    expect(verifyRoundResult(result)).toBe(true);
    expect(verifyRoundResult({ ...result, crashPoint: result.crashPoint + 0.01 })).toBe(false);
    expect(verifyRoundResult({ ...result, nonce: 4 })).toBe(false);
  });
});
