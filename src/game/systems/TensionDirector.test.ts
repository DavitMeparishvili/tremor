/**
 * TensionDirector suite, including the SPECS §6 REQUIRED purity test: theater
 * derives only from (multiplier, elapsed, fxRng) — never the crash point.
 */
import seedrandom from "seedrandom";
import { describe, expect, it } from "vitest";
import { SHAKE_MAX_PX, THUMP_BPM } from "../../sim/constants";
import { multiplierAt, timeToMultiplier } from "../../sim/curve";
import { TensionDirector, type TensionOutput } from "./TensionDirector";

const FX_SEED = "purity-seed:7:fx";
const FRAME_MS = 1000 / 60;

/** Snapshot the reused output object (evaluate recycles it across calls). */
const snap = (o: TensionOutput): TensionOutput => ({ ...o, audioMix: { ...o.audioMix } });

/**
 * Drive a round exactly as TremorGame does — frame timestamps in, multiplier
 * from the pure curve — and record every TensionOutput until the round ends
 * (crash) or the recording is truncated, whichever comes first.
 */
function recordRound(crashPoint: number, truncateAtMs: number): TensionOutput[] {
  const director = new TensionDirector();
  const fxRng = seedrandom(FX_SEED);
  const tCrash = timeToMultiplier(crashPoint);
  const frames: TensionOutput[] = [];
  for (let t = 0; t < truncateAtMs && t < tCrash; t += FRAME_MS) {
    frames.push(snap(director.evaluate(multiplierAt(t), t, fxRng)));
  }
  return frames;
}

describe("TensionDirector purity (SPECS §6 — golden rule #1)", () => {
  it("a 50x round truncated at m=1.2 is frame-identical to a round crashing at 1.2x", () => {
    const t12 = timeToMultiplier(1.2);
    const bigRound = recordRound(50, t12); // heading to 50x, recording stops at 1.2
    const smallRound = recordRound(1.2, Number.POSITIVE_INFINITY); // actually crashes at 1.2
    expect(bigRound.length).toBeGreaterThan(0);
    expect(bigRound).toEqual(smallRound);
  });

  it("never consumes fxRng (a variable draw count would desync the shared cosmetic stream)", () => {
    const director = new TensionDirector();
    for (const m of [1, 1.4, 2.9, 6.5, 14, 30]) {
      let draws = 0;
      const counting = () => {
        draws++;
        return 0.5;
      };
      director.evaluate(m, 1000, counting);
      expect(draws).toBe(0);
    }
  });
});

describe("band mapping (plan §4.4 thresholds)", () => {
  const rng = () => 0.5;

  it.each([
    [1.0, "CALM"],
    [1.49, "CALM"],
    [1.5, "STIRRING"],
    [2.99, "STIRRING"],
    [3.0, "HUNTED"],
    [6.99, "HUNTED"],
    [7.0, "FRENZY"],
    [14.99, "FRENZY"],
    [15.0, "APEX"],
    [500, "APEX"],
  ] as const)("m=%f → %s", (m, band) => {
    expect(new TensionDirector().evaluate(m, 0, rng).band).toBe(band);
  });

  it("intensity is min(1, log(m)/log(20)) and clamps at 1", () => {
    const d = new TensionDirector();
    expect(d.evaluate(1, 0, rng).intensity).toBe(0);
    expect(d.evaluate(4.472, 0, rng).intensity).toBeCloseTo(0.5, 2);
    expect(d.evaluate(20, 0, rng).intensity).toBe(1);
    expect(d.evaluate(1e6, 0, rng).intensity).toBe(1);
  });
});

describe("channel outputs", () => {
  const rng = () => 0.5;

  it("every channel ramps monotonically with the multiplier, no discontinuities", () => {
    const d = new TensionDirector();
    let prev = snap(d.evaluate(1, 0, rng));
    for (let m = 1.01; m < 40; m *= 1.01) {
      const cur = snap(d.evaluate(m, 0, rng));
      expect(cur.pingRate).toBeGreaterThanOrEqual(prev.pingRate);
      expect(cur.shakePeak).toBeGreaterThanOrEqual(prev.shakePeak);
      expect(cur.sandLevel).toBeGreaterThanOrEqual(prev.sandLevel);
      expect(cur.thumpIntervalMs).toBeLessThanOrEqual(prev.thumpIntervalMs);
      // continuity: one 1% multiplier step never jumps a channel by more than 5%
      expect(Math.abs(cur.pingRate - prev.pingRate)).toBeLessThan(0.4);
      expect(Math.abs(cur.shakePeak - prev.shakePeak)).toBeLessThan(0.3);
      prev = cur;
    }
  });

  it("shakePeak never exceeds SHAKE_MAX_PX and is 0 under reduced motion", () => {
    const d = new TensionDirector();
    for (const m of [1, 2, 5, 10, 100]) {
      expect(d.evaluate(m, 0, rng).shakePeak).toBeLessThanOrEqual(SHAKE_MAX_PX);
    }
    d.reducedMotion = true;
    expect(d.evaluate(100, 0, rng).shakePeak).toBe(0);
  });

  it("thump anchors at THUMP_BPM in CALM and quickens toward APEX (never slows)", () => {
    const d = new TensionDirector();
    expect(d.evaluate(1, 0, rng).thumpIntervalMs).toBe(60_000 / THUMP_BPM);
    expect(d.evaluate(1.4, 0, rng).thumpIntervalMs).toBe(60_000 / THUMP_BPM);
    expect(d.evaluate(20, 0, rng).thumpIntervalMs).toBeLessThan(60_000 / THUMP_BPM);
  });

  it("audioMix stays in 0..1 and APEX drops layers instead of adding (machinery → 0)", () => {
    const d = new TensionDirector();
    for (const m of [1, 2, 5, 10, 14, 20, 80]) {
      for (const v of Object.values(d.evaluate(m, 0, rng).audioMix)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    const frenzy = snap(d.evaluate(10, 0, rng));
    const apex = snap(d.evaluate(20, 0, rng));
    expect(frenzy.audioMix.machinery).toBeGreaterThan(0);
    expect(apex.audioMix.machinery).toBe(0);
    expect(apex.audioMix.klaxon).toBe(0);
    expect(apex.audioMix.subDrone).toBeGreaterThan(0);
  });
});
