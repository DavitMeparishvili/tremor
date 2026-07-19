import { describe, expect, it } from "vitest";
import {
  ARMING_MS,
  BETTING_MS,
  CRASHED_MS,
  SETTLING_MS,
  STARTING_BALANCE,
} from "./constants";
import { multiplierAt, timeToMultiplier } from "./curve";
import { createEngine, type TremorEngine } from "./engine";
import { LocalSeededProvider, crashPointForRound } from "./outcome";
import type { EngineEvent } from "./types";

/** First round runs from t = RUN_START when ticking starts at t = 0. */
const RUN_START = BETTING_MS + ARMING_MS;

const round2 = (x: number): number => Math.round(x * 100) / 100;
const floor2 = (x: number): number => Math.floor(x * 100) / 100;

/** Drain the microtask chains behind nextRound/requestCashout resolution. */
const flush = async (levels = 6): Promise<void> => {
  for (let i = 0; i < levels; i++) await Promise.resolve();
};

/** Deterministic search for a seed whose FIRST round crashes as required. */
function findSeed(pred: (cp: number) => boolean): string {
  for (let i = 0; i < 100_000; i++) {
    if (pred(crashPointForRound(`engine-test-${i}`, 1))) return `engine-test-${i}`;
  }
  throw new Error("no matching seed found");
}

function makeEngine(seed: string, initialBalance = STARTING_BALANCE) {
  const engine = createEngine({ provider: new LocalSeededProvider(seed), initialBalance });
  const events: EngineEvent[] = [];
  engine.on((e) => events.push(e));
  return { engine, events };
}

/** tick(0) … through arming so the first round is RUNNING at RUN_START. */
async function startRunning(engine: TremorEngine): Promise<void> {
  engine.tick(0);
  await flush();
  engine.tick(RUN_START);
  await flush();
}

describe("phase state machine", () => {
  it("transitions on nominal tick-driven boundaries", async () => {
    const seed = findSeed((cp) => cp >= 2 && cp <= 20);
    const cp = crashPointForRound(seed, 1);
    const tCrash = timeToMultiplier(cp);
    const { engine, events } = makeEngine(seed);
    const phases = () =>
      events.filter((e) => e.type === "phaseChanged").map((e) => [e.phase, e.endsAt]);

    engine.tick(0);
    expect(phases()).toEqual([["betting", BETTING_MS]]);
    await flush();

    engine.tick(BETTING_MS - 1);
    expect(phases()).toHaveLength(1); // still betting
    engine.tick(BETTING_MS);
    expect(phases().at(-1)).toEqual(["arming", RUN_START]);

    engine.tick(RUN_START - 1);
    expect(phases()).toHaveLength(2);
    engine.tick(RUN_START);
    expect(phases().at(-1)).toEqual(["running", null]);
    expect(events.some((e) => e.type === "roundStarted" && e.spec.nonce === 1)).toBe(true);

    engine.tick(RUN_START + tCrash - 5); // just below the crash point
    expect(phases()).toHaveLength(3);

    const crashNow = RUN_START + tCrash + 1;
    engine.tick(crashNow);
    expect(events.at(-2)).toEqual({ type: "crashed", roundId: "r1", crashPoint: cp });
    expect(phases().at(-1)).toEqual(["crashed", crashNow + CRASHED_MS]);

    engine.tick(crashNow + CRASHED_MS);
    expect(phases().at(-1)).toEqual(["settling", crashNow + CRASHED_MS + SETTLING_MS]);

    engine.tick(crashNow + CRASHED_MS + SETTLING_MS);
    expect(phases().at(-1)).toEqual([
      "betting",
      crashNow + CRASHED_MS + SETTLING_MS + BETTING_MS,
    ]);
    await flush();
  });

  it("fast-forwards through missed transitions in a single tick", async () => {
    const seed = findSeed((cp) => cp >= 1.5);
    const { engine, events } = makeEngine(seed);
    engine.tick(0);
    await flush();
    engine.tick(1_000_000); // a long tab stall: betting → arming → running → crash
    const crash = events.find((e) => e.type === "crashed");
    expect(crash).toEqual({
      type: "crashed",
      roundId: "r1",
      crashPoint: crashPointForRound(seed, 1),
    });
    expect(events.filter((e) => e.type === "phaseChanged").at(-1)?.phase).toBe("crashed");
  });

  it("resets bets and advances the nonce for the next round", async () => {
    const seed = findSeed((cp) => cp <= 3);
    const { engine, events } = makeEngine(seed);
    engine.tick(0);
    await flush();
    engine.placeBet(0, 50, null);
    engine.tick(1_000_000); // round 1 crashes (bet busts)
    expect(engine.bets()[0].state).toBe("busted");
    engine.tick(1_000_000 + CRASHED_MS + SETTLING_MS); // → betting for round 2
    await flush();
    expect(engine.bets()[0].state).toBe("idle");
    engine.tick(1_000_000 + CRASHED_MS + SETTLING_MS + BETTING_MS + ARMING_MS);
    const starts = events.filter((e) => e.type === "roundStarted");
    expect(starts.map((e) => e.spec.nonce)).toEqual([1, 2]);
  });

  it("reports 1.00 outside a round and the crash point after it", async () => {
    const seed = findSeed((cp) => cp >= 2 && cp <= 20);
    const cp = crashPointForRound(seed, 1);
    const { engine } = makeEngine(seed);
    engine.tick(0);
    expect(engine.currentMultiplier()).toBe(1);
    await flush();
    engine.tick(BETTING_MS + 10); // arming
    expect(engine.currentMultiplier()).toBe(1);
    engine.tick(RUN_START + 5000);
    expect(engine.currentMultiplier()).toBeCloseTo(multiplierAt(5000), 12);
    engine.tick(RUN_START + timeToMultiplier(cp) + 1);
    expect(engine.currentMultiplier()).toBe(cp); // crashed
  });
});

describe("bets and wallet", () => {
  it("accepts a bet, deducts the stake, and replaces on re-place", async () => {
    const seed = findSeed(() => true);
    const { engine, events } = makeEngine(seed, 100);
    engine.tick(0);
    await flush();
    engine.placeBet(0, 60, null);
    expect(engine.balance()).toBe(40);
    engine.placeBet(0, 25, 1.5); // adjust: refund 60, charge 25
    expect(engine.balance()).toBe(75);
    expect(engine.bets()[0]).toMatchObject({ state: "placed", amount: 25, autoCashout: 1.5 });
    expect(events.filter((e) => e.type === "betAccepted")).toHaveLength(2);
  });

  it("rejects with the spec'd reasons", async () => {
    const seed = findSeed((cp) => cp >= 1.5);
    const { engine, events } = makeEngine(seed, 100);
    const lastReject = () => events.filter((e) => e.type === "betRejected").at(-1);

    engine.tick(0);
    await flush();
    engine.placeBet(0, 500, null); // more than the wallet
    expect(lastReject()).toMatchObject({ slot: 0, reason: "balance" });
    engine.placeBet(0, 0, null); // below MIN_BET
    expect(lastReject()).toMatchObject({ slot: 0, reason: "limit" });
    engine.placeBet(0, 5000, null); // above MAX_BET (checked before balance)
    expect(lastReject()).toMatchObject({ slot: 0, reason: "limit" });
    engine.placeBet(0, 10, 1.0); // auto-cashout below AUTO_CASHOUT_MIN
    expect(lastReject()).toMatchObject({ slot: 0, reason: "limit" });

    engine.tick(BETTING_MS + 1); // arming: betting window closed
    engine.placeBet(1, 10, null);
    expect(lastReject()).toMatchObject({ slot: 1, reason: "phase" });
    expect(engine.balance()).toBe(100); // nothing was charged
  });

  it("settles a manual cashout at the current multiplier and pays amount × m", async () => {
    const seed = findSeed((cp) => cp >= 3);
    const { engine, events } = makeEngine(seed);
    engine.tick(0);
    await flush();
    engine.placeBet(0, 100, null);
    await startRunning(engine);

    const tCash = RUN_START + timeToMultiplier(2) + 3; // a hair past 2.00x
    engine.tick(tCash);
    engine.requestCashout(0);
    expect(engine.bets()[0].state).toBe("cashingOut"); // async settle, ≤1 microtask chain
    await flush();

    const expectedM = floor2(multiplierAt(tCash - RUN_START));
    const expectedPayout = round2(100 * expectedM);
    expect(events.at(-1)).toEqual({
      type: "cashedOut",
      slot: 0,
      multiplier: expectedM,
      payout: expectedPayout,
    });
    expect(engine.bets()[0]).toMatchObject({
      state: "cashedOut",
      cashedOutAt: expectedM,
      payout: expectedPayout,
    });
    expect(engine.balance()).toBe(round2(STARTING_BALANCE - 100 + expectedPayout));
  });

  it("triggers auto-cashout at the first tick reaching the target", async () => {
    const seed = findSeed((cp) => cp >= 3);
    const { engine } = makeEngine(seed);
    engine.tick(0);
    await flush();
    engine.placeBet(1, 40, 1.5);
    await startRunning(engine);

    // step in frames; find the first tick where the curve reaches 1.5x
    let t = RUN_START;
    while (multiplierAt(t - RUN_START) < 1.5) t += 16;
    engine.tick(t - 16);
    await flush();
    expect(engine.bets()[1].state).toBe("live");
    engine.tick(t);
    await flush();
    const bet = engine.bets()[1];
    expect(bet.state).toBe("cashedOut");
    expect(bet.cashedOutAt).toBe(floor2(multiplierAt(t - RUN_START)));
  });

  it("busts bets that never cashed out, without touching the wallet again", async () => {
    const seed = findSeed((cp) => cp >= 1.2);
    const { engine } = makeEngine(seed);
    engine.tick(0);
    await flush();
    engine.placeBet(0, 100, null);
    engine.tick(1_000_000);
    await flush();
    expect(engine.bets()[0].state).toBe("busted");
    expect(engine.balance()).toBe(STARTING_BALANCE - 100);
  });
});

describe("tie-break rule (SPECS §3)", () => {
  it("settles an auto-cashout at exactly the crash point as a win, before the crash event", async () => {
    const seed = findSeed((cp) => cp >= 1.5 && cp <= 5);
    const cp = crashPointForRound(seed, 1);
    const { engine, events } = makeEngine(seed);
    engine.tick(0);
    await flush();
    engine.placeBet(0, 100, cp); // target == crash point
    engine.placeBet(1, 100, null); // rides to the bust
    await startRunning(engine);

    engine.tick(RUN_START + timeToMultiplier(cp) + 1);
    await flush();

    const types = events.map((e) => e.type);
    expect(types.indexOf("cashedOut")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("cashedOut")).toBeLessThan(types.indexOf("crashed"));
    expect(engine.bets()[0]).toMatchObject({
      state: "cashedOut",
      cashedOutAt: cp,
      payout: round2(100 * cp),
    });
    expect(engine.bets()[1].state).toBe("busted");
    expect(engine.balance()).toBe(round2(STARTING_BALANCE - 200 + round2(100 * cp)));
  });

  it("busts an auto target above the crash point, even when both land in one frame", async () => {
    const seed = findSeed((cp) => cp >= 1.5 && cp <= 5);
    const cp = crashPointForRound(seed, 1);
    const { engine, events } = makeEngine(seed);
    engine.tick(0);
    await flush();
    engine.placeBet(0, 100, round2(cp + 0.5));
    await startRunning(engine);
    engine.tick(1_000_000); // curve leaps past target AND crash point together
    await flush();
    expect(engine.bets()[0].state).toBe("busted");
    expect(events.some((e) => e.type === "cashedOut")).toBe(false);
  });
});

describe("determinism", () => {
  async function runSession(seed: string): Promise<string> {
    const provider = new LocalSeededProvider(seed);
    const engine = createEngine({ provider, initialBalance: 10_000 });
    const log: EngineEvent[] = [];
    engine.on((e) => {
      log.push(e);
      if (e.type === "phaseChanged" && e.phase === "betting") {
        engine.placeBet(0, 20, 1.6);
        engine.placeBet(1, 20, null);
      }
    });
    let crashes = 0;
    engine.on((e) => {
      if (e.type === "crashed") crashes++;
    });
    for (let t = 0; crashes < 3 && t < 400_000; t += 16) {
      engine.tick(t);
      if (engine.bets()[1].state === "live" && engine.currentMultiplier() >= 1.25) {
        engine.requestCashout(1);
      }
      await Promise.resolve(); // frame boundary: let cashouts settle
      await Promise.resolve();
    }
    return JSON.stringify(log);
  }

  it("same seed + same tick script ⇒ identical event logs", async () => {
    const [a, b] = await Promise.all([runSession("replay-seed"), runSession("replay-seed")]);
    expect(a).toBe(b);
    expect(a).toContain('"crashed"');
  });

  it("different seeds diverge", async () => {
    const [a, b] = await Promise.all([runSession("replay-seed"), runSession("other-seed")]);
    expect(a).not.toBe(b);
  });
});
