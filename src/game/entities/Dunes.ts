/**
 * Desert backdrop (plan M3): code-drawn sky gradient + low sun, a heat-shimmer
 * haze band on the horizon, and three seamless-tileable dune layers that
 * parallax-scroll as the crawler advances.
 *
 * Golden rule #1: everything here is a function of elapsed time and the scroll
 * speed handed in by TremorGame — never the crash point.
 */
import {
  Assets,
  Container,
  FillGradient,
  Graphics,
  type Texture,
  TilingSprite,
} from "pixi.js";
import { REFERENCE_HEIGHT, SHAKE_BLEED_PX } from "../layers";

/** Horizon lines as fractions of screen height (same as the M0 placeholder). */
export const HORIZON_FAR = 0.52;
export const HORIZON_MID = 0.66;
export const HORIZON_NEAR = 0.8;

interface DuneLayerSpec {
  alias: string;
  label: string;
  horizon: number;
  /** y of the tileable seam edge inside the SVG (flat at x=0 and x=max). */
  edgeY: number;
  texHeight: number;
  /** Solid color of the SVG's bottom fill — the skirt below the band matches it. */
  baseColor: number;
  /** Scroll multiplier: far layers drift slower (parallax depth). */
  parallax: number;
}

const LAYER_SPECS: DuneLayerSpec[] = [
  { alias: "duneFar", label: "dunesFar", horizon: HORIZON_FAR, edgeY: 130, texHeight: 260, baseColor: 0xcda06b, parallax: 0.15 },
  { alias: "duneMid", label: "dunesMid", horizon: HORIZON_MID, edgeY: 120, texHeight: 280, baseColor: 0xa9743f, parallax: 0.45 },
  { alias: "duneNear", label: "dunesNear", horizon: HORIZON_NEAR, edgeY: 110, texHeight: 300, baseColor: 0x8a5a33, parallax: 1 },
];

interface DuneLayer {
  spec: DuneLayerSpec;
  root: Container;
  ridge: TilingSprite;
  skirt: Graphics;
}

export class Dunes {
  private readonly sky = new Container({ label: "sky" });
  private readonly skyFill = new Graphics({ label: "skyFill" });
  private readonly sun = new Graphics({ label: "sun" });
  private readonly haze = new Graphics({ label: "haze" });
  private readonly layers: DuneLayer[];

  constructor() {
    this.sky.addChild(this.skyFill, this.sun, this.haze);
    this.layers = LAYER_SPECS.map((spec) => {
      const root = new Container({ label: spec.label });
      const skirt = new Graphics({ label: `${spec.label}Skirt` });
      const ridge = new TilingSprite({
        texture: Assets.get<Texture>(spec.alias),
        label: `${spec.label}Ridge`,
      });
      root.addChild(skirt, ridge);
      return { spec, root, ridge, skirt };
    });
  }

  /** Adds children in SPECS §7 order: sky, dunesFar, dunesMid, dunesNear. */
  addTo(world: Container): void {
    world.addChild(this.sky, ...this.layers.map((l) => l.root));
  }

  /**
   * @param playHeight height available for the composition (M7 mobile pass):
   * on portrait the DOM bet panel covers the bottom of the screen, so horizons
   * are placed within this band while fills still extend to the real bottom.
   */
  layout(width: number, height: number, playHeight: number = height): void {
    const pad = SHAKE_BLEED_PX;
    const scale = Math.max(0.5, height / REFERENCE_HEIGHT);

    // Sky: dusk-haze gradient (palette: #F2C89B up top → #C96B4A at the horizon).
    const skyGradient = new FillGradient({
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: 0xf2c89b },
        { offset: 1, color: 0xc96b4a },
      ],
    });
    this.skyFill
      .clear()
      .rect(-pad, -pad, width + pad * 2, playHeight * HORIZON_FAR + pad + 40)
      .fill(skyGradient);

    // Low hot sun with a wide halo, sitting just above the far horizon.
    const sunR = playHeight * 0.085;
    const sunGradient = new FillGradient({
      type: "radial",
      colorStops: [
        { offset: 0, color: "rgba(252,233,192,0.95)" },
        { offset: 0.45, color: "rgba(245,201,143,0.55)" },
        { offset: 1, color: "rgba(245,201,143,0)" },
      ],
    });
    this.sun
      .clear()
      .circle(width * 0.72, playHeight * 0.45, sunR * 2.2)
      .fill(sunGradient);

    // Heat-shimmer haze band straddling the far horizon; update() breathes its alpha.
    const hazeGradient = new FillGradient({
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: "rgba(242,200,155,0)" },
        { offset: 0.5, color: "rgba(242,200,155,0.9)" },
        { offset: 1, color: "rgba(242,200,155,0)" },
      ],
    });
    this.haze
      .clear()
      .rect(-pad, playHeight * HORIZON_FAR - playHeight * 0.035, width + pad * 2, playHeight * 0.07)
      .fill(hazeGradient);
    this.haze.alpha = 0.07;

    for (const { spec, root, ridge, skirt } of this.layers) {
      const horizonY = playHeight * spec.horizon;
      root.position.set(0, horizonY - spec.edgeY * scale);
      ridge.position.set(-pad, 0);
      ridge.width = width + pad * 2;
      // Inset 1 texture px top/bottom: repeat addressing wrap-blends the solid
      // bottom row into the transparent top row, drawing a hard line otherwise.
      ridge.height = (spec.texHeight - 2) * scale;
      ridge.tileScale.set(scale);
      ridge.tilePosition.y = -scale;
      // Solid fill from the band's bottom to past the screen bottom.
      const skirtTop = ridge.height - 1;
      const skirtH = Math.max(0, height + pad - root.position.y - skirtTop);
      skirt
        .clear()
        .rect(-pad, skirtTop, width + pad * 2, skirtH)
        .fill(spec.baseColor);
    }
  }

  /**
   * @param scrollPx world scroll this frame in screen px (ground/near-layer speed)
   */
  update(nowMs: number, scrollPx: number, reducedMotion: boolean): void {
    for (const { spec, ridge } of this.layers) {
      ridge.tilePosition.x -= scrollPx * spec.parallax;
    }
    // Shimmer: slow two-sine breathing; a steady veil under reduced motion.
    this.haze.alpha = reducedMotion
      ? 0.07
      : 0.07 + 0.035 * Math.sin(nowMs * 0.0013) + 0.02 * Math.sin(nowMs * 0.0031);
  }
}
