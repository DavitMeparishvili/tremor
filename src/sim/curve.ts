import { CURVE_K } from "./constants";

/**
 * The multiplier is a pure function of elapsed round time — never integrated
 * per frame — so it is frame-rate independent, drift-free, and replayable.
 * m(t) = e^(K·t): 2x ≈ 11.5s, 10x ≈ 38.4s at CURVE_K = 0.00006/ms.
 */
export const multiplierAt = (tMs: number): number => Math.exp(CURVE_K * tMs);

/** Inverse of `multiplierAt`: the elapsed ms at which the curve reaches `m`. */
export const timeToMultiplier = (m: number): number => Math.log(m) / CURVE_K;
