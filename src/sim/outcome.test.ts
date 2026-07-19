import { describe, expect, it } from "vitest";
import seedrandom from "seedrandom";
import {
  LocalSeededProvider,
  crashPointForRound,
  crashPointFromUniform,
  fxRngForRound,
  outcomeRngForRound,
} from "./outcome";

const flush = async (levels = 6): Promise<void> => {
  for (let i = 0; i < levels; i++) await Promise.resolve();
};

describe("crashPointFromUniform", () => {
  it("maps known uniforms to known crash points", () => {
    expect(crashPointFromUniform(0)).toBe(1.0); // house-edge instant bust
    expect(crashPointFromUniform(0.0099)).toBe(1.0);
    expect(crashPointFromUniform(0.5)).toBe(1.98); // the median
    expect(crashPointFromUniform(0.901)).toBe(10.0);
  });

  it("always returns ≥ 1.00 with exactly 2 decimals", () => {
    const rng = seedrandom("tremor-quantize-test");
    for (let i = 0; i < 10_000; i++) {
      const cp = crashPointFromUniform(rng());
      expect(cp).toBeGreaterThanOrEqual(1);
      expect(Math.round(cp * 100) / 100).toBe(cp);
    }
  });

  it("matches the Bustabit distribution over 10^6 samples", () => {
    const rng = seedrandom("tremor-distribution-test");
    const n = 1_000_000;
    let instant = 0;
    let geMedian = 0;
    let ge10 = 0;
    for (let i = 0; i < n; i++) {
      const cp = crashPointFromUniform(rng());
      if (cp === 1) instant++;
      if (cp >= 1.98) geMedian++;
      if (cp >= 10) ge10++;
    }
    // P(cp ≥ 1.98) = P(r ≥ 0.5) = 0.5 exactly → median ≈ 1.98x.
    expect(geMedian / n).toBeCloseTo(0.5, 2);
    // P(cp ≥ 10) = P(r ≥ 0.901) = 0.099.
    expect(Math.abs(ge10 / n - 0.099)).toBeLessThan(0.002);
    // P(cp == 1.00) ≈ 0.0198: HOUSE_EDGE band plus the r < ~0.0198 region
    // where floor(99/(1−r)) rounds down to 100.
    expect(Math.abs(instant / n - 0.0198)).toBeLessThan(0.001);
  });
});

describe("RNG streams", () => {
  it("is deterministic per (seed, nonce)", () => {
    expect(crashPointForRound("abc", 7)).toBe(crashPointForRound("abc", 7));
    expect(outcomeRngForRound("abc", 7)()).toBe(outcomeRngForRound("abc", 7)());
  });

  it("keeps outcome and fx streams separate (golden rule #1)", () => {
    expect(fxRngForRound("abc", 7)()).not.toBe(outcomeRngForRound("abc", 7)());
  });
});

describe("LocalSeededProvider", () => {
  it("advances the nonce per round and replays deterministically", async () => {
    const a = new LocalSeededProvider("seed-x");
    const b = new LocalSeededProvider("seed-x");
    const specA1 = await a.nextRound();
    const specA2 = await a.nextRound();
    expect(specA1.nonce).toBe(1);
    expect(specA2.nonce).toBe(2);
    expect(specA1.seed).toBe("seed-x");
    expect((await b.nextRound()).roundId).toBe(specA1.roundId);
  });

  it("fires onCrash exactly once, with the deterministic crash point", async () => {
    const provider = new LocalSeededProvider("crash-test");
    const expected = crashPointForRound("crash-test", 1);
    const fired: Array<{ roundId: string; crashPoint: number }> = [];
    provider.onCrash((roundId, crashPoint) => fired.push({ roundId, crashPoint }));
    const spec = await provider.nextRound();

    provider.tick(spec.roundId, 0, 1);
    provider.tick(spec.roundId, 1000, expected - 0.001);
    expect(fired).toHaveLength(0);
    provider.tick(spec.roundId, 2000, expected);
    expect(fired).toEqual([{ roundId: spec.roundId, crashPoint: expected }]);
    provider.tick(spec.roundId, 3000, expected + 5);
    expect(fired).toHaveLength(1); // never refires
  });

  it("resolves cashouts asynchronously at the reported multiplier, floored to 2 decimals", async () => {
    // deterministic search for a round that leaves room to cash out at 1.35x
    let seed = "";
    for (let i = 0; i < 10_000 && !seed; i++) {
      if (crashPointForRound(`cashout-test-${i}`, 1) > 1.35) seed = `cashout-test-${i}`;
    }
    const provider = new LocalSeededProvider(seed);
    const spec = await provider.nextRound();
    provider.tick(spec.roundId, 5000, 1.34999);

    let settled = false;
    const pending = provider.requestCashout(spec.roundId, 0).then((r) => {
      settled = true;
      return r;
    });
    expect(settled).toBe(false); // never synchronous — rehearses M8 latency
    expect((await pending).multiplier).toBe(1.34);
  });

  it("rejects cashouts once the round has crashed", async () => {
    const provider = new LocalSeededProvider("late-cashout-test");
    const cp = crashPointForRound("late-cashout-test", 1);
    const spec = await provider.nextRound();
    provider.tick(spec.roundId, 10_000, cp + 1); // crash fires
    await expect(provider.requestCashout(spec.roundId, 0)).rejects.toThrow();
    await flush();
  });
});
