import {
  Application,
  BitmapText,
  Ticker,
  UPDATE_PRIORITY,
} from "pixi.js";
import { backgroundLoadDeferred, loadBootAssets } from "../assets/manifest";
import { SHAKE_MAX_PX } from "../sim/constants";
import { engine, useTremorStore } from "../state/store";
import { Crawler } from "./entities/Crawler";
import { Dunes, HORIZON_NEAR } from "./entities/Dunes";
import { createLayers, type Layers, REFERENCE_HEIGHT } from "./layers";
import { MultiplierDisplay } from "./systems/MultiplierDisplay";

const SHAKE_DECAY_MS = 700;

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

  /** 0..1; shake amplitude is trauma², so pulses hit hard and tail off. */
  private trauma = 0;
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
    // Placeholder trigger until the M4 ShakeSystem/M5 eruption timeline exist.
    if (e.code === "KeyS" || e.code === "Space") this.triggerShake();
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

    // SPECS §7 world order: sky, dune layers, then crawler. (worm: M5, sand: M4)
    this.dunes = new Dunes();
    this.dunes.addTo(this.layers.world);
    this.crawler = new Crawler();
    this.layers.world.addChild(this.crawler.view);

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
      if (e.type === "crashed") this.triggerShake();
      if (e.type === "cashedOut") this.crawler.ejectPod(performance.now(), e.slot);
      if (e.type === "phaseChanged" && e.phase === "betting") backgroundLoadDeferred();
    });
    // The engine boots inside BETTING, so the phase event may already be behind us.
    if (useTremorStore.getState().phase === "betting") backgroundLoadDeferred();

    this.layout();
    this.app.renderer.on("resize", this.layout, this);

    this.app.ticker.add(this.update, this, UPDATE_PRIORITY.HIGH);

    window.addEventListener("keydown", this.onKeyDown);
    this.initialized = true;
  }

  /** M4 replaces this with ShakeSystem pulses synced to the crawler thump. */
  triggerShake(): void {
    this.trauma = 1;
  }

  private update(ticker: Ticker): void {
    const now = performance.now();

    // --- sim first (plan §3.3): engine advances, store gets the transient m ---
    engine.tick(now);
    const m = engine.currentMultiplier();
    useTremorStore.setState({ multiplier: m });
    const state = useTremorStore.getState();

    // --- shake: offsets the `world` container ONLY (golden rule #4) ---
    this.trauma = Math.max(0, this.trauma - ticker.deltaMS / SHAKE_DECAY_MS);
    const scale = Math.max(0.5, this.app.screen.height / REFERENCE_HEIGHT);
    const amp = state.settings.reducedMotion
      ? 0
      : SHAKE_MAX_PX * scale * this.trauma * this.trauma;
    this.layers.world.position.set(
      amp * Math.sin(now * 0.055),
      amp * Math.sin(now * 0.047 + 2.1),
    );

    // --- desert world (plan M3) ---
    // The crawler advances only while harvesting; speed eases in/out so phase
    // changes read as a heavy machine, not a switch.
    const targetSpeed = state.phase === "running" ? GROUND_SPEED_PXS * scale : 0;
    this.groundSpeed += (targetSpeed - this.groundSpeed) * Math.min(1, ticker.deltaMS / 400);
    const scrollPx = (this.groundSpeed * ticker.deltaMS) / 1000;
    this.dunes.update(now, scrollPx, state.settings.reducedMotion);
    this.crawler.update(now, state.phase, scrollPx);
    this.layers.world.tint = daylightTint(now);

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
