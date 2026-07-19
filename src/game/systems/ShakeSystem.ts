/**
 * ShakeSystem per plan M4 — pulsed decay shake, NOT per-frame random jitter.
 * Each pulse is a decaying sine (an impact ring-down) modulated by smoothed
 * sine noise so consecutive thumps never feel machine-identical.
 *
 * Golden rules #1 and #4: pulses are triggered by the thump rhythm and sized
 * by TensionDirector output (multiplier-derived, never crash-point-derived),
 * and the offset is applied to the `world` container ONLY — `hud`/`fx` are
 * siblings and never move. Reduced motion zeroes everything.
 *
 * Motion comfort (plan constraint #4): total offset is hard-capped at
 * SHAKE_MAX_PX (1080p reference; caller passes the screen scale).
 */
import type { Container } from "pixi.js";
import { SHAKE_MAX_PX } from "../../sim/constants";

/** Ring-down envelope time constant; a pulse is spent well inside one thump. */
const PULSE_DECAY_MS = 190;
/** Oscillation frequency of the impact ring-down. */
const PULSE_HZ = 8;
/** Past this a pulse's contribution is sub-visible — drop it. */
const PULSE_LIFE_MS = 700;
/** Overlapping pulses beyond this are inaudible noise; keep the list tiny. */
const MAX_PULSES = 6;
/** Golden-angle direction sequence: varied but fully deterministic (no RNG). */
const GOLDEN_ANGLE = 2.399963;

interface Pulse {
  startedAt: number;
  amp: number;
  dirX: number;
  dirY: number;
}

export class ShakeSystem {
  private readonly pulses: Pulse[] = [];
  private pulseCount = 0;

  constructor(private readonly world: Container) {}

  /**
   * Fire one impact pulse peaking at `peakPx` (reference-1080p px). Called on
   * each thump impact; also the placeholder crash kick until the M5 eruption.
   */
  pulse(nowMs: number, peakPx: number): void {
    if (peakPx <= 0) return;
    const a = this.pulseCount++ * GOLDEN_ANGLE;
    if (this.pulses.length >= MAX_PULSES) this.pulses.shift();
    this.pulses.push({
      startedAt: nowMs,
      amp: peakPx,
      // Vertically biased: drill impacts read as ground thuds, not wobble.
      dirX: Math.cos(a) * 0.6,
      dirY: 0.6 + 0.4 * Math.abs(Math.sin(a)),
    });
  }

  /** @param scale renderer height / REFERENCE_HEIGHT — SHAKE_MAX_PX is specified at 1080p. */
  update(nowMs: number, scale: number, reducedMotion: boolean): void {
    if (reducedMotion) {
      this.pulses.length = 0;
      this.world.position.set(0, 0);
      return;
    }

    let x = 0;
    let y = 0;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      const t = nowMs - p.startedAt;
      if (t > PULSE_LIFE_MS) {
        this.pulses.splice(i, 1);
        continue;
      }
      const osc = Math.exp(-t / PULSE_DECAY_MS) * Math.sin((t / 1000) * Math.PI * 2 * PULSE_HZ);
      x += p.amp * osc * p.dirX;
      y += p.amp * osc * p.dirY;
    }

    // Smoothed noise (two incommensurate sines) — organic, still deterministic.
    const noise = 0.85 + 0.15 * Math.sin(nowMs * 0.0113) * Math.sin(nowMs * 0.0071 + 1.3);
    x *= noise;
    y *= noise;

    // Hard comfort cap, even when pulses overlap.
    const len = Math.hypot(x, y);
    if (len > SHAKE_MAX_PX) {
      x *= SHAKE_MAX_PX / len;
      y *= SHAKE_MAX_PX / len;
    }
    this.world.position.set(x * scale, y * scale);
  }
}
