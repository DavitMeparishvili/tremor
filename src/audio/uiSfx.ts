/**
 * UI one-shots (M6) — tiny fire-and-forget clicks triggered directly by React
 * controls (chip select). These are UI furniture, not tension theater, so they
 * live outside the AudioDirector: no ramps, no engine events, no per-frame
 * update. The global `Howler.mute` flag (driven by `settings.muted` through
 * AudioDirector each frame) silences them together with everything else.
 *
 * Module-level singleton on purpose: React re-renders must never construct
 * Howls, and StrictMode double-mounts share the one instance harmlessly.
 */
import { Howl } from "howler";

const CHIP_VOL = 0.35;

let chipHowl: Howl | null = null;

/** Chip-select tick. `rate` bends pitch — heavier stakes tick lower. */
export function chipTick(rate = 1): void {
  chipHowl ??= new Howl({ src: [`${import.meta.env.BASE_URL}audio/stems/chipTick.wav`] });
  const id = chipHowl.play();
  chipHowl.volume(CHIP_VOL, id);
  chipHowl.rate(rate, id);
}

/** Playback rate for a quick-chip amount: 10 ticks bright, 500 ticks heavy. */
export function chipRateFor(amount: number): number {
  // log-scaled 10..500 → 0..1, clamped for out-of-range amounts
  const t = Math.min(1, Math.max(0, Math.log(amount / 10) / Math.log(50)));
  return 1.12 - 0.3 * t;
}
