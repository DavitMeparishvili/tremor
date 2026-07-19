import { Container } from "pixi.js";
import { SHAKE_MAX_PX } from "../sim/constants";

/** SHAKE_MAX_PX (and world art in general) is specified at this height; scale with the renderer. */
export const REFERENCE_HEIGHT = 1080;

/** Oversize world-layer fills by this so max shake never reveals the stage background. */
export const SHAKE_BLEED_PX = SHAKE_MAX_PX * 2;

/**
 * Layer hierarchy per SPECS.md §7.
 *
 * Only `world` is ever offset by the ShakeSystem. `fx` and `hud` are siblings
 * of `world` — never children — so flashes, rings, and HUD text stay put at
 * maximum shake.
 */
export interface Layers {
  world: Container;
  fx: Container;
  hud: Container;
}

export function createLayers(stage: Container): Layers {
  const world = new Container({ label: "world" });
  const fx = new Container({ label: "fx" });
  const hud = new Container({ label: "hud" });
  stage.addChild(world, fx, hud);
  return { world, fx, hud };
}
