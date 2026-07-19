import { describe, expect, it } from "vitest";
import { createEngine } from "./engine";
import { LocalSeededProvider } from "./outcome";
import { verifyRoundResult } from "./verify";
import type { RoundPhase, RoundSpec } from "./types";

const round2 = (x: number): number => Math.round(x * 100) / 100;

const NEXT_PHASE: Record<RoundPhase, RoundPhase> = {
  betting: "arming",
  arming: "running",
  running: "crashed",
  crashed: "settling",
  settling: "betting",
};

describe("soak: 1000 full rounds headless (M1 done-condition)", () => {
  it(
    "cycles phases in order, verifies every crash point, and keeps the wallet exact",
    { timeout: 120_000 },
    async () => {
      const seed = "soak-seed";
      const engine = createEngine({
        provider: new LocalSeededProvider(seed),
        initialBalance: 1_000_000,
      });

      let crashes = 0;
      let expectedBalance = 1_000_000;
      let currentSpec: RoundSpec | null = null;
      let lastPhase: RoundPhase | null = null;
      let verifiedAll = true;
      let phaseOrderOk = true;

      engine.on((e) => {
        switch (e.type) {
          case "phaseChanged":
            if (lastPhase !== null && NEXT_PHASE[lastPhase] !== e.phase) phaseOrderOk = false;
            lastPhase = e.phase;
            if (e.phase === "betting" && crashes < 1000) {
              engine.placeBet(0, 10, 2); // hedge slot: auto at the median-ish 2x
              engine.placeBet(1, 10, null); // manual slot, cashed at ≥1.3x below
            }
            break;
          case "betAccepted":
            expectedBalance = round2(expectedBalance - e.amount);
            break;
          case "cashedOut":
            expectedBalance = round2(expectedBalance + e.payout);
            break;
          case "roundStarted":
            currentSpec = e.spec;
            break;
          case "crashed": {
            crashes++;
            const spec = currentSpec;
            if (
              !spec ||
              spec.roundId !== e.roundId ||
              !verifyRoundResult({
                roundId: e.roundId,
                crashPoint: e.crashPoint,
                seed: spec.seed,
                nonce: spec.nonce,
                endedAt: 0,
              })
            ) {
              verifiedAll = false;
            }
            break;
          }
          case "betRejected":
            break;
        }
      });

      let monotonicOk = true;
      let lastRunningM = 0;
      const step = 64; // headless frames; the curve is time-pure, so cadence is free
      for (let t = 0; crashes < 1000; t += step) {
        engine.tick(t);
        if (lastPhase === "running") {
          const m = engine.currentMultiplier();
          if (m < lastRunningM) monotonicOk = false;
          lastRunningM = m;
        } else {
          lastRunningM = 0;
        }
        if (engine.bets()[1].state === "live" && engine.currentMultiplier() >= 1.3) {
          engine.requestCashout(1);
        }
        // frame boundary: let pending cashouts/round specs settle
        await Promise.resolve();
        await Promise.resolve();
        if (t > 100_000_000) throw new Error("soak did not finish in bounded sim time");
      }

      expect(crashes).toBe(1000);
      expect(phaseOrderOk).toBe(true);
      expect(verifiedAll).toBe(true);
      expect(monotonicOk).toBe(true);
      expect(engine.balance()).toBe(expectedBalance);
      expect(engine.balance()).toBeGreaterThan(0);
    },
  );
});
