/**
 * Tuning constants per SPECS.md §1 — single source, no magic numbers in systems.
 * `sim/` stays pure: no pixi/react/state imports anywhere in this directory.
 */

/** 1%; P(instant bust at 1.00x). */
export const HOUSE_EDGE = 0.01;

/** Per ms; m(t) = e^(K·t) → 2x ≈ 11.5s. */
export const CURVE_K = 0.00006;

/** Revisit after M2 playtest. */
export const BETTING_MS = 6000;

export const ARMING_MS = 800;

/** Hard budget — the eruption timeline fits this, never the reverse. */
export const CRASHED_MS = 2500;

export const SETTLING_MS = 1500;

export const MAX_BET_SLOTS = 2;

/** Rhythm anchor: shake pulses, audio stems, crawler cycle. */
export const THUMP_BPM = 60;

/** At 1080p reference; scale with renderer height. */
export const SHAKE_MAX_PX = 6;

/** APEX band. */
export const PARTICLES_STEADY_MAX = 3000;

/** Eruption only. */
export const PARTICLES_BURST_MAX = 8000;

/** Rounds kept for the history bar. */
export const HISTORY_LENGTH = 20;

/** Demo wallet credits; client-side until M8 moves the wallet server-side. */
export const STARTING_BALANCE = 1000;

/** Per slot. */
export const MIN_BET = 1;

/** Per slot. */
export const MAX_BET = 1000;

/** Lowest accepted auto-cashout target. */
export const AUTO_CASHOUT_MIN = 1.01;
