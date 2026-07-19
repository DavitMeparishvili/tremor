import { describe, expect, it } from "vitest";
import { CURVE_K } from "./constants";
import { multiplierAt, timeToMultiplier } from "./curve";

describe("curve", () => {
  it("starts at exactly 1.00x", () => {
    expect(multiplierAt(0)).toBe(1);
  });

  it("hits genre landmarks: 2x ≈ 11.55s, 10x ≈ 38.38s", () => {
    expect(timeToMultiplier(2)).toBeCloseTo(Math.LN2 / CURVE_K, 6);
    expect(timeToMultiplier(2)).toBeCloseTo(11552.45, 1);
    expect(timeToMultiplier(10)).toBeCloseTo(38376.42, 1);
  });

  it("timeToMultiplier inverts multiplierAt", () => {
    for (const t of [0, 137, 5000, 11552.45, 60000, 120000]) {
      expect(timeToMultiplier(multiplierAt(t))).toBeCloseTo(t, 6);
    }
  });

  it("is strictly increasing", () => {
    let prev = multiplierAt(0);
    for (let t = 100; t <= 60000; t += 100) {
      const m = multiplierAt(t);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
  });
});
