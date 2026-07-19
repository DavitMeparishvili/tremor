/**
 * The big multiplier, per plan §3.1/§3.3 and SPECS §7 — lives in `hud`, is
 * `BitmapText` (never DOM), and is the one thing on screen that must stay
 * crisp and readable through maximum world shake. Owns no timing of its own:
 * TremorGame's ticker calls `update(phase, multiplier)` every frame.
 *
 * Color changes go through `.tint` (cheap quad recolor) rather than mutating
 * `style.fill` (would trigger atlas/style rebuild) — see
 * .claude/skills/pixijs-scene-text/references/bitmap-text.md `dynamicFill`.
 */
import { BitmapFont, BitmapText } from "pixi.js";
import type { RoundPhase } from "../../sim/types";

const FONT_NAME = "TremorMultiplier";
const BASE_FONT_SIZE = 120;

const COLOR_LIVE = 0xffe9d1;
const COLOR_CRASHED = 0xff4433;

let fontInstalled = false;

function ensureFont(): void {
  if (fontInstalled) return;
  fontInstalled = true;
  BitmapFont.install({
    name: FONT_NAME,
    style: {
      fontFamily: "monospace",
      fontSize: BASE_FONT_SIZE,
      fontWeight: "bold",
      fill: 0xffffff, // dynamicFill requires a white base atlas; .tint recolors it
    },
    resolution: window.devicePixelRatio || 1,
    dynamicFill: true,
  });
}

export class MultiplierDisplay {
  readonly view: BitmapText;

  constructor() {
    ensureFont();
    this.view = new BitmapText({
      text: "1.00x",
      style: { fontFamily: FONT_NAME, fontSize: BASE_FONT_SIZE },
      anchor: 0.5,
      tint: COLOR_LIVE,
    });
  }

  /** Recomputes position/scale on resize; keeps it centered and legible at any canvas size. */
  layout(width: number, height: number): void {
    this.view.scale.set(Math.max(0.3, Math.min(1, width / 640)));
    this.view.position.set(width / 2, height * 0.36);
  }

  update(phase: RoundPhase, multiplier: number): void {
    switch (phase) {
      case "betting":
        this.view.text = "1.00x";
        this.view.tint = COLOR_LIVE;
        this.view.alpha = 0.35;
        break;
      case "arming":
        this.view.text = "1.00x";
        this.view.tint = COLOR_LIVE;
        this.view.alpha = 0.7;
        break;
      case "running":
        this.view.text = `${multiplier.toFixed(2)}x`;
        this.view.tint = COLOR_LIVE;
        this.view.alpha = 1;
        break;
      case "crashed":
      case "settling":
        this.view.text = `CRASHED @ ${multiplier.toFixed(2)}x`;
        this.view.tint = COLOR_CRASHED;
        this.view.alpha = 1;
        break;
    }
  }
}
