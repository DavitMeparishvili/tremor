import {
  Application,
  BitmapText,
  Ticker,
  UPDATE_PRIORITY,
} from "pixi.js";
import { backgroundLoadDeferred, loadBootAssets } from "../assets/manifest";
import { SHAKE_MAX_PX } from "../sim/constants";
import { fxRngForRound } from "../sim/outcome";
import type { RoundPhase } from "../sim/types";
import { engine, useTremorStore } from "../state/store";
import { Crawler, THUMP_IMPACT_P } from "./entities/Crawler";
import { Dunes, HORIZON_NEAR } from "./entities/Dunes";
import { createLayers, type Layers, REFERENCE_HEIGHT } from "./layers";
import { MultiplierDisplay } from "./systems/MultiplierDisplay";
import { RADAR_RADIUS, RadarSystem } from "./systems/RadarSystem";
import { AMBIENT_SAND_LEVEL, SandSystem } from "./systems/SandSystem";
import { ShakeSystem } from "./systems/ShakeSystem";
import { TensionDirector } from "./systems/TensionDirector";

/** Crawler ground speed while harvesting, px/s at the 1080p reference height. */
const GROUND_SPEED_PXS = 30;

/**
 * Day-cycle tint drift (plan M3): the whole `world` container slowly grades
 * between high-sun white and a deep-dusk multiply over ~9 minutes, so no two
 * rounds sit in exactly the same light. v8 container tint multiplies down the
 * subtree; `hud`/`fx` are siblings and stay untouched. Pure function of wall
 * time — outcome-independent by construction (golden rule #1).
 */
const DAY_CYCLE_MS = 540_000;
const DUSK_TINT = { r: 0xe8, g: 0xbf, b: 0xa4 };

function daylightTint(nowMs: number): number {
  const t = 0.5 - 0.5 * Math.cos((nowMs / DAY_CYCLE_MS) * Math.PI * 2);
  const r = Math.round(0xff + (DUSK_TINT.r - 0xff) * t);
  const g = Math.round(0xff + (DUSK_TINT.g - 0xff) * t);
  const b = Math.round(0xff + (DUSK_TINT.b - 0xff) * t);
  return (r << 16) | (g << 8) | b;
}

/**
 * Owns the Pixi Application and the game world. React mounts it via
 * ui/GameCanvas and never reaches inside; the Zustand store is the only
 * bridge. The ticker drives the sim engine at HIGH priority (plan §3.3).
 */
export class TremorGame {
  private readonly app = new Application();
  private layers!: Layers;

  private dunes!: Dunes;
  private crawler!: Crawler;
  private fpsText!: BitmapText;
  /** The real multiplier display (plan M2) — BitmapText, centered, never DOM. */
  private multiplierDisplay!: MultiplierDisplay;

  // --- M4 tension stack: one director, three consumers (plan §4.4) ---
  private readonly director = new TensionDirector();
  private shake!: ShakeSystem;
  private sand!: SandSystem;
  private radar!: RadarSystem;
  /**
   * Cosmetic RNG stream — reseeded per round from the round spec, shared by
   * radar and sand. Separate from the outcome stream by construction (golden
   * rule #1). The boot stream covers the pre-first-round ambient theater.
   */
  private fxRng: () => number = fxRngForRound("tremor-boot", 0);

  /**
   * Shared thump oscillator (0..1). A phase accumulator — not a modulo of
   * elapsed time — so the TensionDirector quickening the interval at HUNTED+
   * bends the rhythm without skipping a beat. Crawler drill, shake pulses,
   * and M6 thump SFX all read this one phase.
   */
  private thumpPhase = 0;
  private prevPhase: RoundPhase | null = null;
  private phaseAnchorMs = 0;

  /** Eased current world scroll speed in px/s at screen scale. */
  private groundSpeed = 0;
  private fpsAccumMs = 0;
  private initialized = false;
  private destroyed = false;
  private engineUnsub: (() => void) | null = null;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // Ignore keystrokes typed into BetPanel inputs — only bare canvas shortcuts here.
    const target = e.target as HTMLElement | null;
    if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
    // Debug kick: one max-amplitude shake pulse.
    if (e.code === "KeyS" || e.code === "Space") {
      this.shake?.pulse(performance.now(), SHAKE_MAX_PX);
    }
  };

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: "#c96b4a", // matches the sky's horizon color while assets load
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    host.appendChild(this.app.canvas);

    await loadBootAssets();

    this.layers = createLayers(this.app.stage);

    // SPECS §7 world order: sky, dune layers, crawler, (worm: M5), sand.
    this.dunes = new Dunes();
    this.dunes.addTo(this.layers.world);
    this.crawler = new Crawler();
    this.layers.world.addChild(this.crawler.view);
    this.sand = new SandSystem(this.app.renderer);
    this.layers.world.addChild(this.sand.view);

    this.shake = new ShakeSystem(this.layers.world);

    this.radar = new RadarSystem();
    this.layers.hud.addChild(this.radar.view);

    this.fpsText = new BitmapText({
      text: "-- FPS",
      style: { fontFamily: "monospace", fontSize: 14, fill: 0x35e0c8 },
    });
    this.fpsText.anchor.set(1, 0);
    this.layers.hud.addChild(this.fpsText);

    this.multiplierDisplay = new MultiplierDisplay();
    this.layers.hud.addChild(this.multiplierDisplay.view);

    this.engineUnsub = engine.on((e) => {
      // Placeholder eruption feedback until the M5 worm timeline exists. Reacts
      // to the crash EVENT — never anticipates the hidden crash point.
      if (e.type === "crashed") this.shake.pulse(performance.now(), SHAKE_MAX_PX);
      if (e.type === "cashedOut") this.crawler.ejectPod(performance.now(), e.slot);
      if (e.type === "phaseChanged" && e.phase === "betting") backgroundLoadDeferred();
      if (e.type === "roundStarted") {
        // Reseed the cosmetic stream from the round spec (SPECS §4) and wipe
        // the scope — every round's theater noise is its own replayable stream.
        this.fxRng = fxRngForRound(e.spec.seed, e.spec.nonce);
        this.radar.reset();
      }
    });
    // The engine boots inside BETTING, so the phase event may already be behind us.
    if (useTremorStore.getState().phase === "betting") backgroundLoadDeferred();

    this.layout();
    this.app.renderer.on("resize", this.layout, this);

    this.app.ticker.add(this.update, this, UPDATE_PRIORITY.HIGH);

    window.addEventListener("keydown", this.onKeyDown);
    this.initialized = true;
  }

  private update(ticker: Ticker): void {
    const now = performance.now();

    // --- sim first (plan §3.3): engine advances, store gets the transient m ---
    engine.tick(now);
    const m = engine.currentMultiplier();
    useTremorStore.setState({ multiplier: m });
    const state = useTremorStore.getState();
    const reducedMotion = state.settings.reducedMotion;
    const running = state.phase === "running";
    const scale = Math.max(0.5, this.app.screen.height / REFERENCE_HEIGHT);

    if (state.phase !== this.prevPhase) {
      this.prevPhase = state.phase;
      this.phaseAnchorMs = now;
      if (running) this.thumpPhase = 0;
    }

    // --- tension (plan §3.3): ONE evaluation, every theatrical system reads it.
    // Input is (m, elapsed, fxRng) — the crash point cannot reach this line.
    this.director.reducedMotion = reducedMotion;
    const tension = this.director.evaluate(
      running ? m : 1,
      running ? now - this.phaseAnchorMs : 0,
      this.fxRng,
    );

    // --- shared thump oscillator; a pulse fires exactly at the drill impact ---
    let thumpPhase = 0;
    if (running) {
      const prev = this.thumpPhase;
      this.thumpPhase = (prev + ticker.deltaMS / tension.thumpIntervalMs) % 1;
      const crossedImpact =
        prev < THUMP_IMPACT_P && (this.thumpPhase >= THUMP_IMPACT_P || this.thumpPhase < prev);
      if (crossedImpact) this.shake.pulse(now, tension.shakePeak);
      thumpPhase = this.thumpPhase;
    }

    // --- shake: offsets the `world` container ONLY (golden rule #4) ---
    this.shake.update(now, scale, reducedMotion);

    // --- desert world (plan M3) ---
    // The crawler advances only while harvesting; speed eases in/out so phase
    // changes read as a heavy machine, not a switch.
    const targetSpeed = running ? GROUND_SPEED_PXS * scale : 0;
    this.groundSpeed += (targetSpeed - this.groundSpeed) * Math.min(1, ticker.deltaMS / 400);
    const scrollPx = (this.groundSpeed * ticker.deltaMS) / 1000;
    this.dunes.update(now, scrollPx, reducedMotion);
    this.crawler.update(now, state.phase, scrollPx, thumpPhase);
    this.layers.world.tint = daylightTint(now);

    // --- tension consumers (plan M4) ---
    this.sand.update(ticker.deltaMS, running ? tension.sandLevel : AMBIENT_SAND_LEVEL, this.fxRng);
    this.radar.update(now, ticker.deltaMS, tension, state.phase, this.fxRng);

    // --- the real multiplier display (plan M2) ---
    this.multiplierDisplay.update(state.phase, m);

    // --- FPS readout, throttled to 4 Hz for readability ---
    this.fpsAccumMs += ticker.elapsedMS;
    if (this.fpsAccumMs >= 250) {
      this.fpsAccumMs = 0;
      this.fpsText.text = `${Math.round(ticker.FPS)} FPS`;
    }
  }

  private layout(): void {
    const { width: w, height: h } = this.app.screen;
    const s = Math.max(0.6, h / REFERENCE_HEIGHT);

    this.dunes.layout(w, h);

    // Grounded on the near dune band, a touch left of center so the drill's
    // strike point sits under the multiplier without hiding behind BetPanel.
    this.crawler.view.scale.set(s);
    this.crawler.view.position.set(w * 0.46, h * HORIZON_NEAR + 26 * s);

    this.sand.layout(w, h, s, this.crawler.view.x, this.crawler.view.y);

    // Radar: top-left corner widget (plan open question #3 — corner HUD for
    // now). React's HUD column is centered, FPS sits top-right; no overlap.
    const radarScale = Math.max(0.55, Math.min(1, h / REFERENCE_HEIGHT));
    const radarMargin = 14 + (RADAR_RADIUS + 4) * radarScale;
    this.radar.layout(radarMargin, radarMargin, radarScale);

    this.fpsText.position.set(w - 12, 10);
    this.multiplierDisplay.layout(w, h);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    this.engineUnsub?.();
    if (this.initialized) {
      // Textures stay alive: they belong to the shared Assets cache, and a
      // StrictMode remount's second TremorGame renders the same instances.
      this.app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
    }
  }
}
