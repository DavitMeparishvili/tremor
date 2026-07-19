import { Container } from "pixi.js";

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
