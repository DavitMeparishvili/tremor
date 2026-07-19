/**
 * TensionDirector per SPECS.md §6 and plan §4.4 — the single source of truth
 * mapping the live multiplier to theatrical intensity. Every tension consumer
 * (ShakeSystem, SandSystem, RadarSystem, AudioDirector) keys off this one
 * output; systems never invent their own multiplier→feel mapping.
 *
 * Golden rule #1, enforced structurally: `evaluate` receives only
 * (currentMultiplier, elapsedMs, fxRng). The crash point does not exist here,
 * so a round headed for 50x and a round headed for 1.5x produce identical
 * output at the same multiplier. The §6 purity test pins this.
 *
 * Pure TS on purpose — no pixi/react/state imports — so the vitest suite can
 * drive it headless.
 */
import { SHAKE_MAX_PX, THUMP_BPM } from "../../sim/constants";

export type TensionBand = "CALM" | "STIRRING" | "HUNTED" | "FRENZY" | "APEX";

export type StemName = "machinery" | "heartbeat" | "bassRumble" | "klaxon" | "subDrone";

export interface TensionOutput {
  band: TensionBand;
  /** min(1, log(m)/log(20)), continuous 0..1. */
  intensity: number;
  /** Radar pings/sec. */
  pingRate: number;
  /** Px at the 1080p reference, ≤ SHAKE_MAX_PX; 0 under reduced motion. */
  shakePeak: number;
  /** 0..1 spawn-rate multiplier for SandSystem. */
  sandLevel: number;
  /** 60000 / THUMP_BPM at CALM; quickens from HUNTED up (plan §4.4). */
  thumpIntervalMs: number;
  /** Target volumes 0..1; AudioDirector (M6) ramps toward these, never cuts. */
  audioMix: Record<StemName, number>;
}

const BASE_THUMP_MS = 60_000 / THUMP_BPM;
const LN20 = Math.log(20);

/** Intensity of a multiplier — the x-axis of the anchor table below. */
const intensityOf = (m: number): number => Math.min(1, Math.log(Math.max(1, m)) / LN20);

const STEMS: readonly StemName[] = ["machinery", "heartbeat", "bassRumble", "klaxon", "subDrone"];

interface Anchor {
  i: number; // intensity breakpoint (band entry multiplier)
  ping: number;
  shake: number;
  sand: number;
  thumpScale: number;
  mix: readonly [number, number, number, number, number]; // STEMS order
}

/**
 * Plan §4.4 table, one row per band entry point, piecewise-lerped on intensity
 * so no channel ever steps discontinuously as the multiplier climbs.
 *
 * Deliberate trick from the plan: APEX gets QUIETER — machinery/bass/klaxon
 * drop out toward heartbeat + sub-drone ("the worm is listening"), giving the
 * M5 eruption impact contrast to land against.
 */
const ANCHORS: readonly Anchor[] = [
  { i: 0,                ping: 0.4, shake: 0.6, sand: 0.1,  thumpScale: 1,    mix: [0.8, 0,    0,    0,    0] },
  { i: intensityOf(1.5), ping: 1,   shake: 2,   sand: 0.3,  thumpScale: 1,    mix: [0.8, 0.4,  0,    0,    0] },
  { i: intensityOf(3),   ping: 2,   shake: 3.5, sand: 0.55, thumpScale: 0.9,  mix: [0.7, 0.6,  0.55, 0,    0] },
  { i: intensityOf(7),   ping: 4,   shake: 5,   sand: 0.85, thumpScale: 0.75, mix: [0.45, 0.8, 0.7,  0.35, 0.15] },
  { i: intensityOf(15),  ping: 7,   shake: 6,   sand: 1,    thumpScale: 0.65, mix: [0,   0.9,  0,    0,    0.8] },
  { i: 1,                ping: 8,   shake: 6,   sand: 1,    thumpScale: 0.6,  mix: [0,   0.9,  0,    0,    0.8] },
];

function bandOf(m: number): TensionBand {
  if (m < 1.5) return "CALM";
  if (m < 3) return "STIRRING";
  if (m < 7) return "HUNTED";
  if (m < 15) return "FRENZY";
  return "APEX";
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class TensionDirector {
  /** Set from store settings each frame by TremorGame; zeroes shakePeak per SPECS §6. */
  reducedMotion = false;

  /**
   * Reused across calls (perf budget §6: no per-frame allocations) — consume
   * synchronously within the frame; clone if you need to retain a snapshot.
   */
  private readonly out: TensionOutput = {
    band: "CALM",
    intensity: 0,
    pingRate: ANCHORS[0].ping,
    shakePeak: 0,
    sandLevel: ANCHORS[0].sand,
    thumpIntervalMs: BASE_THUMP_MS,
    audioMix: { machinery: 0, heartbeat: 0, bassRumble: 0, klaxon: 0, subDrone: 0 },
  };

  /**
   * The one theatrical input (SPECS §6). `elapsedMs` and `fxRng` are part of
   * the contract for consumers that need time/noise; the director itself must
   * never draw from `fxRng` here — a draw whose count varied with `m` would
   * desync the shared cosmetic stream between systems.
   */
  evaluate(multiplier: number, _elapsedMs: number, _fxRng: () => number): TensionOutput {
    const i = intensityOf(multiplier);

    let hi = 1;
    while (hi < ANCHORS.length - 1 && ANCHORS[hi].i < i) hi++;
    const a = ANCHORS[hi - 1];
    const b = ANCHORS[hi];
    const t = b.i > a.i ? Math.min(1, Math.max(0, (i - a.i) / (b.i - a.i))) : 1;

    const out = this.out;
    out.band = bandOf(multiplier);
    out.intensity = i;
    out.pingRate = lerp(a.ping, b.ping, t);
    out.shakePeak = this.reducedMotion ? 0 : Math.min(SHAKE_MAX_PX, lerp(a.shake, b.shake, t));
    out.sandLevel = lerp(a.sand, b.sand, t);
    out.thumpIntervalMs = BASE_THUMP_MS * lerp(a.thumpScale, b.thumpScale, t);
    for (let s = 0; s < STEMS.length; s++) {
      out.audioMix[STEMS[s]] = lerp(a.mix[s], b.mix[s], t);
    }
    return out;
  }
}
