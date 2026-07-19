/**
 * Crash-moment screen FX per plan M5 and SPECS §7 — the breach screen flash
 * and the expanding shockwave ring. Lives in the `fx` layer: a sibling of
 * `world`, so it NEVER shakes (golden rule #4) and sits under `hud`, so the
 * multiplier stays readable through the brightest frame.
 *
 * Driven by UNSCALED time (ticker.elapsedMS): the hit-stop slows the world via
 * `ticker.speed`/deltaMS, but the flash must decay at real speed (a held
 * bright frame is a photosensitivity hazard, not drama) and the ring racing
 * out over a frozen world is the contrast that sells the hit-stop.
 */
import { Container, Graphics } from "pixi.js";

const FLASH_COLOR = 0xfff1dc;
const FLASH_MS = 260;

const RING_COLOR = 0xffd9a8;
const RING_MS = 700;

export class CrashFxSystem {
  readonly view = new Container({ label: "crashFx" });

  private readonly ring = new Graphics({ label: "shockwave" });
  private readonly flash = new Graphics({ label: "flash" });

  private width = 0;

  private flashAgeMs = Infinity;
  private flashPeak = 0;

  private ringAgeMs = Infinity;
  private ringX = 0;
  private ringY = 0;
  private ringScale = 1;

  constructor() {
    this.flash.alpha = 0;
    this.view.addChild(this.ring, this.flash);
  }

  layout(width: number, height: number): void {
    this.width = width;
    this.flash.clear().rect(0, 0, width, height).fill(FLASH_COLOR);
  }

  /** @param peak 0..1 — callers pass a small value under reduced motion. */
  triggerFlash(peak: number): void {
    this.flashAgeMs = 0;
    this.flashPeak = peak;
  }

  /** @param x/y breach point in screen px; @param scale renderer height scale. */
  triggerShockwave(x: number, y: number, scale: number): void {
    this.ringAgeMs = 0;
    this.ringX = x;
    this.ringY = y;
    this.ringScale = scale;
  }

  /** @param dtMs UNSCALED frame time (ticker.elapsedMS) — see header. */
  update(dtMs: number): void {
    if (this.flashAgeMs <= FLASH_MS) {
      this.flashAgeMs += dtMs;
      const t = Math.min(1, this.flashAgeMs / FLASH_MS);
      this.flash.alpha = this.flashPeak * (1 - t) * (1 - t);
    } else if (this.flash.alpha !== 0) {
      this.flash.alpha = 0;
    }

    if (this.ringAgeMs <= RING_MS) {
      this.ringAgeMs += dtMs;
      const t = Math.min(1, this.ringAgeMs / RING_MS);
      const eased = 1 - (1 - t) * (1 - t);
      const radius = 40 * this.ringScale + eased * this.width * 0.3;
      this.ring
        .clear()
        .circle(this.ringX, this.ringY, radius)
        .stroke({
          color: RING_COLOR,
          width: Math.max(1.5, (14 - 11 * eased) * this.ringScale),
          alpha: 0.85 * (1 - t),
        });
      if (t >= 1) this.ring.clear();
    }
  }
}
