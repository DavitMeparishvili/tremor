/**
 * SandSystem per plan M4 — one `ParticleContainer` (single draw call) renders
 * every grain of ambient sand theater: drifting dust motes at CALM, tread
 * ripples from STIRRING, and sand geysers from HUNTED up, all scaled by the
 * TensionDirector's `sandLevel`.
 *
 * Golden rule #1: spawn rates derive from sandLevel (multiplier-derived) and
 * all randomness comes from the round's `fxRng` cosmetic stream — the crash
 * point never appears here.
 *
 * Perf budget (plan §6): the full PARTICLES_BURST_MAX pool is preallocated
 * once; update() allocates nothing. Steady-state spawns are gated at
 * PARTICLES_STEADY_MAX live grains — the headroom above that is reserved for
 * the M5 eruption's `burst()`. Only `position` and `color` are dynamic GPU
 * properties — scale/anchor variety is baked in at pool construction so the
 * static vertex buffer never re-uploads.
 */
import {
  Graphics,
  Particle,
  ParticleContainer,
  Rectangle,
  type Renderer,
  type Texture,
} from "pixi.js";
import { PARTICLES_BURST_MAX, PARTICLES_STEADY_MAX } from "../../sim/constants";
import { SHAKE_BLEED_PX } from "../layers";

/** Baseline ambient dust outside RUNNING — the desert is never fully still. */
export const AMBIENT_SAND_LEVEL = 0.06;

export const DUST_TINT = 0xe4bd8d;
export const RIPPLE_TINT = 0xc08a4f;
export const GEYSER_TINT = 0xa56d36;

/**
 * One eruption plume/cloud (M5). Velocities are a cone around `angle`
 * (radians; -PI/2 is straight up), spawn positions a squashed disc of
 * `radius`. Caller pre-scales px values to screen scale.
 */
export interface BurstSpec {
  x: number;
  y: number;
  count: number;
  angle: number;
  /** Cone half-width in radians. */
  spread: number;
  speedMin: number;
  speedMax: number;
  gravity: number;
  lifeMinMs: number;
  lifeMaxMs: number;
  alphaMin: number;
  alphaMax: number;
  tint: number;
  radius: number;
}

/** A spawn burst longer than this is a stalled tab, not a frame — don't dump particles. */
const MAX_SPAWN_DT_MS = 100;

interface Grain {
  ageMs: number;
  lifeMs: number;
  vx: number;
  vy: number;
  gravity: number;
  baseAlpha: number;
}

function makeGrainTexture(renderer: Renderer): Texture {
  const g = new Graphics()
    .circle(6, 6, 6)
    .fill({ color: 0xffffff, alpha: 0.3 })
    .circle(6, 6, 3.6)
    .fill({ color: 0xffffff, alpha: 0.55 })
    .circle(6, 6, 1.8)
    .fill({ color: 0xffffff, alpha: 1 });
  const texture = renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return texture;
}

export class SandSystem {
  readonly view: ParticleContainer;

  private readonly particles: Particle[] = [];
  private readonly grains: Grain[] = [];
  private readonly free: number[] = [];

  private width = 0;
  private height = 0;
  private scale = 1;
  private crawlerX = 0;
  private groundY = 0;

  private dustAccum = 0;
  private rippleAccum = 0;
  private geyserAccum = 0;
  private liveCount = 0;

  constructor(renderer: Renderer) {
    const texture = makeGrainTexture(renderer);
    this.view = new ParticleContainer({
      label: "sand",
      texture,
      dynamicProperties: { position: true, color: true }, // vertex/rotation/uvs stay static
      boundsArea: new Rectangle(0, 0, 1, 1), // real bounds set in layout()
    });

    // Preallocate the whole pool incl. eruption headroom; dead grains sit at alpha 0.
    for (let i = 0; i < PARTICLES_BURST_MAX; i++) {
      const particle = new Particle({
        texture,
        anchorX: 0.5,
        anchorY: 0.5,
        // Size variety baked into the static vertex buffer (never re-uploaded).
        scaleX: 0.25 + ((i * 37) % 100) / 100,
        scaleY: 0.25 + ((i * 53) % 100) / 100,
        alpha: 0,
      });
      this.view.addParticle(particle);
      this.particles.push(particle);
      this.grains.push({ ageMs: 0, lifeMs: 0, vx: 0, vy: 0, gravity: 0, baseAlpha: 0 });
      this.free.push(i);
    }
  }

  layout(width: number, height: number, scale: number, crawlerX: number, groundY: number): void {
    this.width = width;
    this.height = height;
    this.scale = scale;
    this.crawlerX = crawlerX;
    this.groundY = groundY;
    const pad = SHAKE_BLEED_PX;
    this.view.boundsArea = new Rectangle(-pad, -pad, width + pad * 2, height + pad * 2);
  }

  update(dtMs: number, sandLevel: number, fxRng: () => number): void {
    const spawnDt = Math.min(dtMs, MAX_SPAWN_DT_MS);

    // --- dust motes: always on, density scales with the band ---
    this.dustAccum += ((3 + 30 * sandLevel) * spawnDt) / 1000;
    while (this.dustAccum >= 1) {
      this.dustAccum -= 1;
      this.spawn(
        fxRng() * this.width,
        this.height * (0.45 + 0.55 * fxRng()),
        (fxRng() - 0.5) * 24 * this.scale,
        -(3 + fxRng() * 12) * this.scale,
        0,
        2500 + fxRng() * 2500,
        0.1 + fxRng() * 0.18,
        DUST_TINT,
      );
    }

    // --- tread ripples: the ground stirring around the crawler (STIRRING+) ---
    if (sandLevel >= 0.25) {
      this.rippleAccum += (45 * (sandLevel - 0.2) * spawnDt) / 1000;
      while (this.rippleAccum >= 1) {
        this.rippleAccum -= 1;
        const side = fxRng() < 0.5 ? -1 : 1;
        this.spawn(
          this.crawlerX + side * (30 + fxRng() * 90) * this.scale,
          this.groundY - (2 + fxRng() * 8) * this.scale,
          side * (15 + fxRng() * 45) * this.scale,
          -(4 + fxRng() * 18) * this.scale,
          60 * this.scale,
          400 + fxRng() * 500,
          0.25 + fxRng() * 0.2,
          RIPPLE_TINT,
        );
      }
    }

    // --- sand geysers: stochastic spouts anywhere on the dune band (HUNTED+) ---
    if (sandLevel >= 0.5) {
      this.geyserAccum += (1.6 * (sandLevel - 0.42) * spawnDt) / 1000;
      while (this.geyserAccum >= 1) {
        this.geyserAccum -= 1;
        const gx = this.width * (0.05 + 0.9 * fxRng());
        const gy = this.height * (0.72 + 0.24 * fxRng());
        const count = Math.floor(10 + fxRng() * 22 * sandLevel);
        for (let i = 0; i < count; i++) {
          this.spawn(
            gx + (fxRng() - 0.5) * 18 * this.scale,
            gy + (fxRng() - 0.5) * 6 * this.scale,
            (fxRng() - 0.5) * 130 * this.scale,
            -(160 + fxRng() * 280) * this.scale,
            620 * this.scale,
            650 + fxRng() * 650,
            0.35 + fxRng() * 0.3,
            GEYSER_TINT,
          );
        }
      }
    }

    this.integrate(dtMs);
  }

  /**
   * Eruption burst (plan M5) — bypasses the steady-state gate and may fill the
   * pool up to PARTICLES_BURST_MAX. Randomness from `fxRng` only: the burst is
   * triggered by the crash EVENT, never by the hidden crash point.
   */
  burst(spec: BurstSpec, fxRng: () => number): void {
    for (let n = 0; n < spec.count; n++) {
      const a = spec.angle + (fxRng() - 0.5) * 2 * spec.spread;
      const speed = spec.speedMin + fxRng() * (spec.speedMax - spec.speedMin);
      const r = fxRng() * spec.radius;
      const ra = fxRng() * Math.PI * 2;
      this.spawnRaw(
        spec.x + Math.cos(ra) * r,
        spec.y + Math.sin(ra) * r * 0.4, // squashed disc — a patch of ground, not a ball
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        spec.gravity,
        spec.lifeMinMs + fxRng() * (spec.lifeMaxMs - spec.lifeMinMs),
        spec.alphaMin + fxRng() * (spec.alphaMax - spec.alphaMin),
        spec.tint,
      );
    }
  }

  private integrate(dtMs: number): void {
    // --- integrate live grains (no allocations) ---
    const dtSec = dtMs / 1000;
    for (let i = 0; i < this.grains.length; i++) {
      const grain = this.grains[i];
      if (grain.lifeMs <= 0) continue;
      grain.ageMs += dtMs;
      const particle = this.particles[i];
      if (grain.ageMs >= grain.lifeMs) {
        grain.lifeMs = 0;
        particle.alpha = 0;
        this.free.push(i);
        this.liveCount--;
        continue;
      }
      grain.vy += grain.gravity * dtSec;
      particle.x += grain.vx * dtSec;
      particle.y += grain.vy * dtSec;
      const t = grain.ageMs / grain.lifeMs;
      particle.alpha = grain.baseAlpha * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
    }
  }

  /** Steady-state spawn — gated so ambient theater never eats the eruption headroom. */
  private spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    gravity: number,
    lifeMs: number,
    alpha: number,
    tint: number,
  ): void {
    if (this.liveCount >= PARTICLES_STEADY_MAX) return; // steady cap — spawn dropped
    this.spawnRaw(x, y, vx, vy, gravity, lifeMs, alpha, tint);
  }

  private spawnRaw(
    x: number,
    y: number,
    vx: number,
    vy: number,
    gravity: number,
    lifeMs: number,
    alpha: number,
    tint: number,
  ): void {
    const i = this.free.pop();
    if (i === undefined) return; // pool exhausted — cap respected, spawn dropped
    this.liveCount++;
    const grain = this.grains[i];
    grain.ageMs = 0;
    grain.lifeMs = lifeMs;
    grain.vx = vx;
    grain.vy = vy;
    grain.gravity = gravity;
    grain.baseAlpha = alpha;
    const particle = this.particles[i];
    particle.x = x;
    particle.y = y;
    particle.tint = tint;
    particle.alpha = 0; // attack curve fades it in
  }
}
