/**
 * RadarSystem per plan M4/§4.4 — the seismic scope in the HUD corner: a
 * circular sweep with a fading trail, a ping scheduler driven by the
 * TensionDirector's pingRate, and blips placed from the `fxRng` cosmetic
 * stream.
 *
 * Golden rule #1 — this is the system players WILL try to read, so it is
 * built to be unreadable-as-oracle: blip distance/bearing derive from the
 * tension band plus fxRng noise, and ~15% of pings at HUNTED+ are "near-miss"
 * blips that surge close then recede — pure theater, uncorrelated with the
 * outcome. Lives in `hud`, so it never shakes (golden rule #4).
 *
 * Everything is drawn white and colored via tint, so the whole scope can
 * grade teal → red as APEX approaches without a single Graphics rebuild.
 */
import { Container, Graphics } from "pixi.js";
import type { RoundPhase } from "../../sim/types";
import type { TensionOutput } from "./TensionDirector";

/** Scope radius in local units; layout() scales the whole view. */
export const RADAR_RADIUS = 60;

const TEAL = 0x35e0c8;
const RED = 0xff4433;

const BLIP_POOL = 36;
const NEAR_MISS_CHANCE = 0.15;
/** Sweep base speed: one revolution ≈ 2.6s at CALM, quickening with intensity. */
const SWEEP_RAD_PER_MS = (Math.PI * 2) / 2600;
const TRAIL_RAD = Math.PI * 0.55;
const TRAIL_SEGS = 26;

interface Blip {
  g: Graphics;
  active: boolean;
  bornAt: number;
  lifeMs: number;
  bearing: number;
  dist0: number;
  /** Radial drift in scope-fractions/sec: negative closes in, positive recedes. */
  distV: number;
}

function lerpColor(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 0xff) + (((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * t);
  const g = Math.round(((a >> 8) & 0xff) + (((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * t);
  const bl = Math.round((a & 0xff) + ((b & 0xff) - (a & 0xff)) * t);
  return (r << 16) | (g << 8) | bl;
}

export class RadarSystem {
  readonly view = new Container({ label: "radar" });

  private readonly grid: Graphics;
  private readonly sweep: Graphics;
  private readonly blips: Blip[] = [];

  private sweepRot = 0;
  private pingAccum = 0;

  constructor() {
    const R = RADAR_RADIUS;

    const dish = new Graphics({ label: "radarDish" })
      .circle(0, 0, R + 4)
      .fill({ color: 0x0b1512, alpha: 0.8 });
    this.view.addChild(dish);

    // Grid drawn white, colored by tint each frame (teal → APEX red).
    this.grid = new Graphics({ label: "radarGrid" });
    this.grid
      .circle(0, 0, R)
      .stroke({ width: 1.5, color: 0xffffff, alpha: 0.55 })
      .circle(0, 0, R * 0.66)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.22 })
      .circle(0, 0, R * 0.33)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.22 })
      .moveTo(-R, 0)
      .lineTo(R, 0)
      .moveTo(0, -R)
      .lineTo(0, R)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.14 })
      .circle(0, 0, 2)
      .fill({ color: 0xffffff, alpha: 0.9 }); // the crawler: you are here
    this.view.addChild(this.grid);

    // Sweep wedge with a quadratically fading trail behind the leading edge.
    this.sweep = new Graphics({ label: "radarSweep" });
    for (let k = 0; k < TRAIL_SEGS; k++) {
      const a1 = -(k * TRAIL_RAD) / TRAIL_SEGS;
      const a0 = -((k + 1) * TRAIL_RAD) / TRAIL_SEGS;
      const alpha = 0.35 * (1 - k / TRAIL_SEGS) ** 2;
      this.sweep.moveTo(0, 0).arc(0, 0, R, a0, a1).lineTo(0, 0).fill({ color: 0xffffff, alpha });
    }
    this.sweep.moveTo(0, 0).lineTo(R, 0).stroke({ width: 1.5, color: 0xffffff, alpha: 0.85 });
    this.view.addChild(this.sweep);

    for (let i = 0; i < BLIP_POOL; i++) {
      const g = new Graphics({ label: `blip${i}`, visible: false })
        .circle(0, 0, 3)
        .fill({ color: 0xffffff });
      this.view.addChild(g);
      this.blips.push({ g, active: false, bornAt: 0, lifeMs: 0, bearing: 0, dist0: 0, distV: 0 });
    }
  }

  /** New round, fresh scope: clear blips and the ping accumulator. */
  reset(): void {
    this.pingAccum = 0;
    for (const b of this.blips) {
      b.active = false;
      b.g.visible = false;
    }
  }

  layout(x: number, y: number, uiScale: number): void {
    this.view.position.set(x, y);
    this.view.scale.set(uiScale);
  }

  update(
    nowMs: number,
    dtMs: number,
    tension: TensionOutput,
    phase: RoundPhase,
    fxRng: () => number,
  ): void {
    const running = phase === "running";

    // Scope presence: dormant while betting, boot flicker during arming.
    if (phase === "betting") this.view.alpha = 0.5;
    else if (phase === "arming") this.view.alpha = 0.45 + 0.45 * Math.abs(Math.sin(nowMs * 0.02));
    else if (running) this.view.alpha = 1;
    else this.view.alpha = 0.7;

    this.sweepRot += dtMs * SWEEP_RAD_PER_MS * (1 + 0.6 * tension.intensity);
    this.sweep.rotation = this.sweepRot;

    // Whole-scope grade toward red as APEX closes in ("radar red").
    const apexT = Math.min(1, Math.max(0, (tension.intensity - 0.86) / 0.14));
    const tint = lerpColor(TEAL, RED, apexT);
    this.grid.tint = tint;
    this.sweep.tint = tint;

    // --- ping scheduler: rate from the tension table, blips only mid-round ---
    if (running) {
      this.pingAccum += (tension.pingRate * dtMs) / 1000;
      while (this.pingAccum >= 1) {
        this.pingAccum -= 1;
        this.spawnBlip(nowMs, tension, fxRng);
      }
    } else {
      this.pingAccum = 0;
    }

    for (const b of this.blips) {
      if (!b.active) continue;
      const age = nowMs - b.bornAt;
      if (age >= b.lifeMs) {
        b.active = false;
        b.g.visible = false;
        continue;
      }
      const t = age / b.lifeMs;
      const dist = Math.max(0.04, b.dist0 + (b.distV * age) / 1000);
      b.g.position.set(
        Math.cos(b.bearing) * dist * RADAR_RADIUS,
        Math.sin(b.bearing) * dist * RADAR_RADIUS,
      );
      b.g.alpha = 0.95 * (t < 0.12 ? t / 0.12 : (1 - t) / 0.88);
      b.g.tint = tint;
      b.g.visible = true;
    }
  }

  private spawnBlip(nowMs: number, tension: TensionOutput, fxRng: () => number): void {
    const blip = this.blips.find((b) => !b.active);
    if (!blip) return;

    // Constant draw count per ping keeps the shared fx stream's cadence
    // independent of band (stream hygiene, not an outcome concern).
    const bearing = fxRng() * Math.PI * 2;
    const jitter = fxRng();
    const roll = fxRng();

    const hunted =
      tension.band === "HUNTED" || tension.band === "FRENZY" || tension.band === "APEX";

    blip.active = true;
    blip.bornAt = nowMs;
    blip.bearing = bearing;
    if (hunted && roll < NEAR_MISS_CHANCE) {
      // Near-miss theater (plan §4.4): surges close, then visibly recedes.
      blip.dist0 = 0.1 + jitter * 0.15;
      blip.distV = 0.22;
      blip.lifeMs = 2000;
    } else {
      // The predator circles closer as intensity climbs — plus fx noise so no
      // two pings at the same multiplier land at the same range.
      blip.dist0 = Math.min(0.95, Math.max(0.1, 1 - 0.8 * tension.intensity + (jitter - 0.5) * 0.3));
      blip.distV = hunted ? -(0.03 + 0.05 * tension.intensity) : 0;
      blip.lifeMs = 1400;
    }
  }
}
