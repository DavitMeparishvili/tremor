/**
 * The harvester (plan M3): hull, scrolling treads, and a drill that slams on
 * the THUMP_BPM grid — the rhythm every tension system syncs to from M4 on.
 * Piece-based animation per ART_AUDIO_DIRECTION §2: the art is rigid parts,
 * all motion lives here in code.
 *
 * Golden rule #1: animation derives from (phase, elapsed) only — the thump
 * cycle, tread scroll, and pod arcs never see the crash point.
 */
import { Assets, Container, Sprite, type Texture, TilingSprite } from "pixi.js";
import { ARMING_MS, SETTLING_MS, THUMP_BPM } from "../../sim/constants";
import type { RoundPhase } from "../../sim/types";

const THUMP_INTERVAL_MS = 60_000 / THUMP_BPM;
const POD_FLIGHT_MS = 1500;

// Local design units: origin = ground contact point under the hull's center.
const TREAD_W = 150;
const TREAD_H = 26;
const HULL_W = 165;
const HULL_BOTTOM_Y = -(TREAD_H - 4); // hull skirt overlaps the tread top
const DRILL_X = 92; // ahead of the hull's front bracket
const DRILL_BASE_Y = -105; // bit tip touches y=0 at offset 0
/** Drill offset while parked between rounds (bit raised clear of the sand). */
const PARK_OFFSET = -26;
/** Drill offset while working (bit resting at harvest depth). */
const WORK_OFFSET = -8;

/**
 * One thump: slow hydraulic raise, fast slam, short settle. Returns an offset
 * added to WORK_OFFSET; the impact lands at p=0.8.
 */
function thumpCurve(p: number): number {
  if (p < 0.7) {
    const t = p / 0.7;
    return -16 * (t * t * (3 - 2 * t)); // smoothstep raise
  }
  if (p < 0.8) {
    const t = (p - 0.7) / 0.1;
    return -16 + 22 * t * t; // accelerating slam, +6 overshoot into the sand
  }
  return 6 * (1 - (p - 0.8) / 0.2); // settle back to depth
}

interface Pod {
  sprite: Sprite;
  startedAt: number;
  x0: number;
  y0: number;
  driftX: number;
}

export class Crawler {
  readonly view = new Container({ label: "crawler" });

  private readonly hull: Sprite;
  private readonly treads: TilingSprite;
  private readonly drill: Sprite;
  private readonly podTexture: Texture;
  private pods: Pod[] = [];

  private prevPhase: RoundPhase | null = null;
  private phaseAnchorMs = 0;

  constructor() {
    this.treads = new TilingSprite({
      texture: Assets.get<Texture>("crawlerTreads"),
      label: "treads",
      width: TREAD_W,
      height: TREAD_H,
      position: { x: -TREAD_W / 2, y: -TREAD_H },
    });
    this.treads.tileScale.set(TREAD_H / 28);

    this.hull = new Sprite({
      texture: Assets.get<Texture>("crawlerHull"),
      label: "hull",
      anchor: { x: 0.5, y: 1 },
      position: { x: 0, y: HULL_BOTTOM_Y },
    });
    this.hull.scale.set(HULL_W / this.hull.texture.width);

    this.drill = new Sprite({
      texture: Assets.get<Texture>("crawlerDrill"),
      label: "drill",
      anchor: { x: 0.5, y: 0 },
      position: { x: DRILL_X, y: DRILL_BASE_Y + PARK_OFFSET },
    });
    this.drill.scale.set(0.95);

    this.podTexture = Assets.get<Texture>("cargoPod");

    // Drill behind the hull's front bracket, pods launch from behind the cab.
    this.view.addChild(this.drill, this.treads, this.hull);
  }

  /**
   * Cashout reward (plan §4.5): the harvester launches a glowing cargo pod to
   * safety while the crawler keeps drilling for remaining bettors.
   */
  ejectPod(nowMs: number, slot: 0 | 1): void {
    const x0 = -14 + slot * 26;
    const y0 = -78;
    const sprite = new Sprite({
      texture: this.podTexture,
      anchor: 0.5,
      position: { x: x0, y: y0 },
      label: `pod${slot}`,
    });
    this.view.addChild(sprite);
    this.pods.push({ sprite, startedAt: nowMs, x0, y0, driftX: -(110 + slot * 50) });
  }

  /**
   * @param scrollPx world scroll this frame in screen px; treads counter-scroll
   *                 so the track visually grips the passing ground.
   */
  update(nowMs: number, phase: RoundPhase, scrollPx: number): void {
    if (phase !== this.prevPhase) {
      this.prevPhase = phase;
      this.phaseAnchorMs = nowMs;
    }
    const sincePhase = nowMs - this.phaseAnchorMs;

    const viewScale = this.view.scale.x || 1;
    this.treads.tilePosition.x -= scrollPx / viewScale;

    let drillOffset: number;
    let hullDip = 0;
    switch (phase) {
      case "betting": {
        // Parked: drill raised, engine idling.
        drillOffset = PARK_OFFSET + Math.sin(nowMs * 0.0012) * 1.5;
        hullDip = Math.sin(nowMs * 0.0019) * 0.8;
        break;
      }
      case "arming": {
        // Drill spins up and lowers to harvest depth with a shudder.
        const t = Math.min(1, sincePhase / ARMING_MS);
        const ease = 1 - (1 - t) * (1 - t);
        drillOffset =
          PARK_OFFSET + (WORK_OFFSET - PARK_OFFSET) * ease + Math.sin(nowMs * 0.16) * 1.4 * t;
        break;
      }
      case "running": {
        // The harvest rhythm; amplitude eases in over the first ~half thump.
        const env = Math.min(1, sincePhase / 600);
        const p = (sincePhase % THUMP_INTERVAL_MS) / THUMP_INTERVAL_MS;
        drillOffset = WORK_OFFSET + thumpCurve(p) * env;
        if (p >= 0.8) hullDip = 2.5 * (1 - (p - 0.8) / 0.2) * env;
        break;
      }
      case "crashed": {
        // Frozen mid-harvest — the M5 eruption timeline takes over this beat.
        drillOffset = WORK_OFFSET + 6;
        hullDip = 1.5;
        break;
      }
      case "settling": {
        // Winch the drill back up for the next round.
        const t = Math.min(1, sincePhase / SETTLING_MS);
        drillOffset = WORK_OFFSET + 6 + (PARK_OFFSET - WORK_OFFSET - 6) * t * t;
        break;
      }
    }
    this.drill.y = DRILL_BASE_Y + drillOffset;
    this.hull.y = HULL_BOTTOM_Y + hullDip;

    for (let i = this.pods.length - 1; i >= 0; i--) {
      const pod = this.pods[i];
      const t = (nowMs - pod.startedAt) / POD_FLIGHT_MS;
      if (t >= 1) {
        pod.sprite.destroy();
        this.pods.splice(i, 1);
        continue;
      }
      pod.sprite.position.set(
        pod.x0 + pod.driftX * t,
        pod.y0 - 240 * t - 120 * t * t, // accelerating ascent to safety
      );
      pod.sprite.rotation = -0.4 * t;
      pod.sprite.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      pod.sprite.scale.set(1 + 0.1 * t);
    }
  }
}
