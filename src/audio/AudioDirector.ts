/**
 * AudioDirector per plan M6 — the Howler layer stack from the §4.4 tension
 * table. One looped Howl per stem; every frame each stem's volume RAMPS toward
 * `TensionOutput.audioMix` (never hard cuts), so band changes glide and the
 * APEX "drop layers instead of adding" trick lands as a slow strip-down.
 *
 * The one deliberate exception to "no hard cuts" is the crash dropout: on the
 * crash event every stem ducks to near-silence in ~70 ms so the eruption roar
 * (a one-shot, unaffected by the duck) lands against quiet — plan M6's
 * "~150ms of near-silence before the roar".
 *
 * Golden rule #1 notes: this class consumes TensionDirector output and engine
 * events only — the crash point never reaches it before the crash fires. It
 * also draws NOTHING from `fxRng`: the fx stream is shared with radar/sand,
 * and audio-conditional draws would let audio state desync the visuals. Thump
 * pitch variation is a deterministic golden-ratio sequence instead.
 *
 * No pixi/react/state imports — TremorGame feeds it phase, tension, and the
 * mute flag; it never reaches into the store.
 */
import { Howl, Howler } from "howler";
import type { StemName, TensionOutput } from "../game/systems/TensionDirector";
import type { RoundPhase } from "../sim/types";

const LOOP_STEMS: readonly StemName[] = [
  "machinery",
  "heartbeat",
  "bassRumble",
  "klaxon",
  "subDrone",
];

/** Outside RUNNING the crawler idles: machinery murmurs, every other stem out. */
const IDLE_MACHINERY = 0.22;

/** Ramp rates, volume units/s. Rising is slower than falling — tension creeps in. */
const RISE_PER_S = 0.55;
const FALL_PER_S = 1.2;
/** Crash dropout rate: full mix → near-silence in ~70 ms. */
const DUCK_PER_S = 14;
/** Dropout hold from the crash event — covers the worm's pre-tremor up to the roar. */
const DUCK_HOLD_MS = 340;

const MASTER_VOLUME = 0.9;
const THUMP_BASE_VOL = 0.3;
const THUMP_INTENSITY_VOL = 0.5;
const POD_LAUNCH_VOL = 0.55;
const BET_LOCK_VOL = 0.5;
const ROAR_VOL = 0.95;

interface LoopState {
  howl: Howl;
  /** Our ramped volume — tracked here because Howl#volume() is async while loading. */
  vol: number;
}

export class AudioDirector {
  private readonly loops = new Map<StemName, LoopState>();
  private readonly thumpHowl: Howl;
  private readonly podHowl: Howl;
  private readonly betHowl: Howl;
  private readonly roarHowl: Howl;
  private preloaded = false;
  private duckUntil = -Infinity;
  private userMuted = false;
  private backgrounded = false;
  /** What Howler.mute currently holds — userMuted OR backgrounded. */
  private appliedMute: boolean | null = null;
  private thumpCount = 0;

  /**
   * Placeholder tier ships generated `.wav` stems (scripts/generate-stems.mjs);
   * real stems swap to `.webm` + `.mp3` per SPECS §8 by changing `src` here.
   */
  constructor(basePath: string) {
    for (const name of LOOP_STEMS) {
      this.loops.set(name, {
        howl: new Howl({ src: [`${basePath}${name}.wav`], loop: true, volume: 0, preload: false }),
        vol: 0,
      });
    }
    this.thumpHowl = new Howl({ src: [`${basePath}thump.wav`], preload: false });
    this.podHowl = new Howl({ src: [`${basePath}podLaunch.wav`], preload: false });
    this.betHowl = new Howl({ src: [`${basePath}betLock.wav`], preload: false });
    this.roarHowl = new Howl({ src: [`${basePath}eruption.wav`], preload: false });
  }

  /**
   * Kick off loading + start the loop beds at volume 0. Called when the first
   * BETTING phase is observed (same moment as the deferred art bundle) so audio
   * IO never blocks first paint. Howler queues playback through both loading
   * and the browser autoplay unlock, so calling play() here is safe.
   */
  preload(): void {
    if (this.preloaded) return;
    this.preloaded = true;
    Howler.volume(MASTER_VOLUME);
    for (const { howl } of this.loops.values()) {
      // play() on an unloaded Howl only queues — it does NOT trigger the load.
      howl.load();
      howl.play();
    }
    this.thumpHowl.load();
    this.podHowl.load();
    this.betHowl.load();
    this.roarHowl.load();
  }

  /**
   * Per-frame ramp step. `dtMs` must be UNSCALED frame time (ticker.elapsedMS)
   * — the M5 hit-stop slows the world, not the soundscape.
   */
  update(
    nowMs: number,
    dtMs: number,
    tension: TensionOutput,
    phase: RoundPhase,
    muted: boolean,
  ): void {
    this.userMuted = muted;
    this.applyMute();
    if (!this.preloaded) return;

    const ducking = nowMs < this.duckUntil;
    const dt = dtMs / 1000;
    for (const name of LOOP_STEMS) {
      const stem = this.loops.get(name)!;
      let target: number;
      if (ducking || phase === "crashed") {
        target = 0; // dropout, then stay out under the dust until SETTLING ramps idle back
      } else if (phase === "running") {
        target = tension.audioMix[name];
      } else {
        target = name === "machinery" ? IDLE_MACHINERY : 0;
      }
      const rate = ducking ? DUCK_PER_S : target > stem.vol ? RISE_PER_S : FALL_PER_S;
      const step = Math.max(-rate * dt, Math.min(rate * dt, target - stem.vol));
      if (step !== 0) {
        stem.vol += step;
        stem.howl.volume(stem.vol);
      }
    }
  }

  /**
   * Hidden-tab handling (M7): Howler keeps Web Audio running while rAF — and
   * with it every volume ramp — is frozen, so a hidden tab would drone the
   * last-heard mix indefinitely. TremorGame flips this from `visibilitychange`.
   */
  setBackgrounded(hidden: boolean): void {
    this.backgrounded = hidden;
    this.applyMute();
  }

  private applyMute(): void {
    const target = this.userMuted || this.backgrounded;
    if (target !== this.appliedMute) {
      this.appliedMute = target;
      Howler.mute(target);
    }
  }

  /**
   * Drill-impact one-shot. TremorGame calls this on the exact thump-oscillator
   * crossing that fires ShakeSystem pulses, so the heard hit is sample-locked
   * to the felt one. Louder as tension climbs; pitch wobbles deterministically.
   */
  thump(intensity: number): void {
    if (!this.preloaded) return;
    const id = this.thumpHowl.play();
    this.thumpHowl.volume(THUMP_BASE_VOL + THUMP_INTENSITY_VOL * intensity, id);
    const r = (this.thumpCount++ * 0.618034) % 1; // golden-ratio sequence, no RNG
    this.thumpHowl.rate(0.94 + 0.12 * r, id);
  }

  /** Cashout sting — the pod launch, fired from the engine's cashedOut event. */
  podLaunch(): void {
    if (!this.preloaded) return;
    const id = this.podHowl.play();
    this.podHowl.volume(POD_LAUNCH_VOL, id);
  }

  /** Bet-accepted confirm — the stake clamps onto the crawler. Fires on betAccepted. */
  betPlaced(): void {
    if (!this.preloaded) return;
    const id = this.betHowl.play();
    this.betHowl.volume(BET_LOCK_VOL, id);
  }

  /** Crash event: start the pre-roar dropout. The roar itself waits for the breach. */
  crashDropout(nowMs: number): void {
    this.duckUntil = nowMs + DUCK_HOLD_MS;
  }

  /** The eruption impact — fired from the worm timeline's breach beat. */
  eruptionRoar(): void {
    if (!this.preloaded) return;
    const id = this.roarHowl.play();
    this.roarHowl.volume(ROAR_VOL, id);
  }

  /** Unload everything — StrictMode double-mount safe, like TremorGame.destroy. */
  destroy(): void {
    for (const { howl } of this.loops.values()) howl.unload();
    this.thumpHowl.unload();
    this.podHowl.unload();
    this.betHowl.unload();
    this.roarHowl.unload();
  }
}
