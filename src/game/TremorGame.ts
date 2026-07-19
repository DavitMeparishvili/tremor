import {
  Application,
  BitmapText,
  Graphics,
  Ticker,
  UPDATE_PRIORITY,
} from "pixi.js";
import { SHAKE_MAX_PX } from "../sim/constants";
import { createLayers, type Layers } from "./layers";

/** SHAKE_MAX_PX is specified at this reference height; scale with the renderer. */
const REFERENCE_HEIGHT = 1080;
const SHAKE_DECAY_MS = 700;
/** Oversize world-layer fills so max shake never reveals the stage background. */
const SHAKE_BLEED_PX = SHAKE_MAX_PX * 2;

/**
 * Owns the Pixi Application and the game world. React mounts it via
 * ui/GameCanvas and never reaches inside; the Zustand store becomes the only
 * bridge from M1 on.
 */
export class TremorGame {
  private readonly app = new Application();
  private layers!: Layers;

  // M0 placeholders — replaced by Dunes/Crawler entities in M3
  private dunesFar!: Graphics;
  private dunesMid!: Graphics;
  private dunesNear!: Graphics;
  private crawler!: Graphics;
  private fpsText!: BitmapText;

  /** 0..1; shake amplitude is trauma², so pulses hit hard and tail off. */
  private trauma = 0;
  private fpsAccumMs = 0;
  private initialized = false;
  private destroyed = false;

  private readonly reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "KeyS" || e.code === "Space") this.triggerShake();
  };

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: "#cf8f63", // dusk-haze placeholder; real sky gradient in M3
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    host.appendChild(this.app.canvas);

    this.layers = createLayers(this.app.stage);

    this.dunesFar = new Graphics({ label: "dunesFar" });
    this.dunesMid = new Graphics({ label: "dunesMid" });
    this.dunesNear = new Graphics({ label: "dunesNear" });
    this.crawler = new Graphics({ label: "crawler" });
    this.layers.world.addChild(
      this.dunesFar,
      this.dunesMid,
      this.dunesNear,
      this.crawler,
    );

    this.fpsText = new BitmapText({
      text: "-- FPS",
      style: { fontFamily: "monospace", fontSize: 14, fill: 0x35e0c8 },
    });
    this.fpsText.anchor.set(1, 0);
    this.layers.hud.addChild(this.fpsText);

    this.layout();
    this.app.renderer.on("resize", this.layout, this);

    // Engine tick will live at HIGH priority (plan §3.3); render runs at LOW.
    this.app.ticker.add(this.update, this, UPDATE_PRIORITY.HIGH);

    window.addEventListener("keydown", this.onKeyDown);
    this.initialized = true;
  }

  /** M4 replaces this with ShakeSystem pulses synced to the crawler thump. */
  triggerShake(): void {
    this.trauma = 1;
  }

  private update(ticker: Ticker): void {
    // --- shake: offsets the `world` container ONLY (golden rule #4) ---
    this.trauma = Math.max(0, this.trauma - ticker.deltaMS / SHAKE_DECAY_MS);
    const scale = Math.max(0.5, this.app.screen.height / REFERENCE_HEIGHT);
    const amp = this.reducedMotion.matches
      ? 0
      : SHAKE_MAX_PX * scale * this.trauma * this.trauma;
    const t = performance.now();
    this.layers.world.position.set(
      amp * Math.sin(t * 0.055),
      amp * Math.sin(t * 0.047 + 2.1),
    );

    // --- FPS readout, throttled to 4 Hz for readability ---
    this.fpsAccumMs += ticker.elapsedMS;
    if (this.fpsAccumMs >= 250) {
      this.fpsAccumMs = 0;
      this.fpsText.text = `${Math.round(ticker.FPS)} FPS`;
    }
  }

  private layout(): void {
    const { width: w, height: h } = this.app.screen;
    const pad = SHAKE_BLEED_PX;

    const farTop = h * 0.52;
    const midTop = h * 0.66;
    const nearTop = h * 0.8;

    this.dunesFar
      .clear()
      .rect(-pad, farTop, w + pad * 2, h - farTop + pad)
      .fill(0xb9854f);
    this.dunesMid
      .clear()
      .rect(-pad, midTop, w + pad * 2, h - midTop + pad)
      .fill(0xa06d3d);
    this.dunesNear
      .clear()
      .rect(-pad, nearTop, w + pad * 2, h - nearTop + pad)
      .fill(0x8a5a33);

    this.crawler.clear();
    this.crawler.rect(0, 0, 120, 48).fill(0x4a4e57); // hull
    this.crawler.rect(8, 48, 104, 16).fill(0x33363c); // treads
    this.crawler.rect(88, 8, 20, 12).fill(0xa4472a); // rust accent
    const s = Math.max(0.6, h / REFERENCE_HEIGHT);
    this.crawler.scale.set(s);
    this.crawler.position.set(w * 0.5 - 60 * s, nearTop - 64 * s);

    this.fpsText.position.set(w - 12, 10);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    if (this.initialized) {
      this.app.destroy(
        { removeView: true, releaseGlobalResources: true },
        { children: true, texture: true, textureSource: true },
      );
    }
  }
}
