/**
 * The worm (plan M5) — the eruption sequence as a GSAP timeline: pre-tremor
 * ground swell → breach → arc over the crawler → swallow → plunge, all inside
 * the CRASHED_MS budget (the timeline fits the budget, never the reverse).
 *
 * Piece-based animation per ART_AUDIO_DIRECTION §2: maw + body segments are
 * separate sprites from the `deferred` bundle; all motion lives here in code.
 *
 * Two structural rules:
 * - The timeline is built PAUSED and advanced by `advance(deltaMS)` from the
 *   game ticker. `deltaMS` is scaled by `ticker.speed`, so the M5 hit-stop
 *   slows the worm for free while the sim engine (performance.now-driven)
 *   keeps real-time round cadence.
 * - The worm only ever reacts to the crash EVENT (golden rule #1): `erupt()`
 *   is called from the engine's "crashed" event; nothing here can see the
 *   crash point before it fires. Side effects (bursts, shake, flash, hiding
 *   the crawler) go through `EruptionHooks` wired by TremorGame — systems
 *   never call each other directly (SPECS §8).
 */
import { Assets, Container, Graphics, Sprite, type Texture } from "pixi.js";
import { gsap } from "gsap";
import { SHAKE_BLEED_PX } from "../layers";

/** Semantic beats of the eruption; TremorGame maps them onto its systems. */
export interface EruptionHooks {
  /** Shake pulse, px at the 1080p reference. */
  pulse(ampPx: number): void;
  /** Small pre-tremor ground burst at the breach point. */
  ripple(): void;
  /** The big moment: sand explosion, flash, shockwave, hit-stop. */
  breach(): void;
  /** Maw lands on the crawler — hide it, medium burst. */
  swallow(): void;
  /** Lingering dust cloud that settles under the results overlay. */
  dust(): void;
}

export interface EruptOptions {
  /** Breach point x (screen px). */
  x: number;
  /** Where the maw comes down — the crawler's x. */
  targetX: number;
  /** Ground line y (screen px, crawler ground contact). */
  groundY: number;
  /** Renderer height / REFERENCE_HEIGHT. */
  scale: number;
  /** Apex never rises above this y (keeps the worm clear of the top HUD). */
  minApexY: number;
  hooks: EruptionHooks;
}

const SEGMENT_COUNT = 4;
/** Design px at the 1080p reference — the maw dwarfs the ~165px crawler hull. */
const MAW_W = 290;
const SEGMENT_W = 210;

/** Pre-tremor length; the breach lands here. */
const BREACH_T = 0.22;
/** Follow-the-leader delay per body segment. */
const STAGGER_S = 0.07;
/** Mask extends this far (design px) below the ground line — the emergence seam. */
const SUBMERGE_PX = 12;

export class Worm {
  readonly view = new Container({ label: "worm", visible: false });

  private readonly mask = new Graphics({ label: "wormMask" });
  private readonly mound = new Graphics({ label: "wormMound", alpha: 0 });
  /** [0] is the maw; the rest are body segments trailing it. */
  private pieces: Sprite[] = [];
  private tl: gsap.core.Timeline | null = null;
  private built = false;

  constructor() {
    this.view.addChild(this.mound);
    this.view.mask = this.mask;
    this.view.addChild(this.mask);
  }

  /** True while an eruption timeline is live. */
  get erupting(): boolean {
    return this.tl !== null;
  }

  layout(width: number, _height: number, scale: number, groundY: number): void {
    const pad = SHAKE_BLEED_PX;
    this.mask
      .clear()
      .rect(-pad, -pad, width + pad * 2, groundY + SUBMERGE_PX * scale + pad)
      .fill(0xffffff);
  }

  /**
   * Textures live in the `deferred` bundle (background-loaded during the first
   * BETTING, ~12s before the earliest possible crash). If a crash somehow beats
   * the load, the eruption still runs as bursts/shake/flash via the hooks.
   */
  private ensureBuilt(): boolean {
    if (this.built) return true;
    // Cache.has first: Assets.get logs a warning per miss, and a crash can
    // legitimately arrive before the deferred bundle on a very slow network.
    if (!Assets.cache.has("wormMaw") || !Assets.cache.has("wormSegment")) return false;
    const mawTexture = Assets.get<Texture>("wormMaw");
    const segmentTexture = Assets.get<Texture>("wormSegment");

    for (let i = SEGMENT_COUNT; i >= 1; i--) {
      const segment = new Sprite({
        texture: segmentTexture,
        anchor: 0.5,
        visible: false,
        label: `wormSegment${i}`,
      });
      this.pieces[i] = segment;
    }
    const maw = new Sprite({ texture: mawTexture, anchor: 0.5, visible: false, label: "wormMaw" });
    this.pieces[0] = maw;
    // Tail-first child order so the maw renders on top of its own body.
    for (let i = SEGMENT_COUNT; i >= 0; i--) this.view.addChild(this.pieces[i]);
    this.built = true;
    return true;
  }

  /** Kick off the eruption. Any previous timeline is discarded first. */
  erupt(opts: EruptOptions): void {
    this.abort();
    const { x, targetX, groundY, scale: s, hooks } = opts;
    const hasPieces = this.ensureBuilt();
    this.view.visible = true;

    const tl = gsap.timeline({ paused: true, onComplete: () => this.abort() });
    this.tl = tl;

    // --- pre-tremor (0..BREACH_T): the ground swells under the breach point ---
    this.mound
      .clear()
      .ellipse(0, 0, 130 * s, 46 * s)
      .fill(0x8a5a33);
    this.mound.position.set(x, groundY + 8 * s);
    this.mound.scale.set(0.4, 0.05);
    tl.call(() => { hooks.pulse(3); hooks.ripple(); }, undefined, 0.01);
    tl.to(this.mound, { alpha: 1, duration: 0.08 }, 0.01);
    tl.to(this.mound.scale, { x: 1, y: 1, duration: BREACH_T, ease: "power2.in" }, 0.01);
    tl.call(() => { hooks.pulse(4.5); hooks.ripple(); }, undefined, 0.12);

    // --- breach: the mound explodes; flash/shockwave/hit-stop via hooks ---
    tl.call(() => hooks.breach(), undefined, BREACH_T);
    tl.to(this.mound, { alpha: 0, duration: 0.12 }, BREACH_T);

    // --- the worm itself: ballistic arc, segments follow-the-leader ---
    if (hasPieces) {
      const apexY = Math.max(opts.minApexY, groundY - 430 * s);
      const apexX = x - (x - targetX) * 0.5;
      for (let i = 0; i < this.pieces.length; i++) {
        const p = this.pieces[i];
        const at = BREACH_T + i * STAGGER_S;
        const taper = i === 0 ? 1 : 0.92 ** i;
        const width = (i === 0 ? MAW_W : SEGMENT_W) * taper * s;
        p.scale.set(width / p.texture.width);
        tl.set(
          p,
          { x: x + i * 8 * s, y: groundY + (150 + i * 95) * s, rotation: -0.4, visible: true },
          at,
        );
        tl.to(
          p,
          { x: apexX + i * 16 * s, y: apexY + i * 72 * s, rotation: 0.45, duration: 0.5, ease: "power2.out" },
          at,
        );
        tl.to(
          p,
          { x: targetX - i * 8 * s, y: groundY + 60 * s, rotation: 1.05, duration: 0.42, ease: "power2.in" },
          at + 0.5,
        );
        tl.to(p, { y: groundY + 560 * s, duration: 0.5, ease: "power1.in" }, at + 0.92);
        tl.set(p, { visible: false }, at + 1.42);
      }
    }

    // --- swallow + dust settle; total stays ≤ ~1.95s (+hit-stop ≈ 2.2s real) ---
    tl.call(() => { hooks.swallow(); hooks.pulse(6); }, undefined, BREACH_T + 0.92);
    tl.call(() => hooks.dust(), undefined, BREACH_T + 1.0);
  }

  /**
   * Advance the timeline by scaled frame time (ticker.deltaMS / hit-stop-aware).
   * `suppressEvents: false` so `tl.call` beats fire while seeking.
   */
  advance(dtMs: number): void {
    if (!this.tl) return;
    this.tl.time(this.tl.time() + dtMs / 1000, false);
  }

  /** Stop and hide everything — called on completion and on round start. */
  abort(): void {
    if (this.tl) {
      const tl = this.tl;
      this.tl = null;
      tl.kill();
    }
    this.mound.alpha = 0;
    for (const p of this.pieces) p.visible = false;
    this.view.visible = false;
  }
}
