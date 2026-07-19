/**
 * Asset manifest per SPECS.md §8 — bundle `boot` (dunes, crawler, pod) loads
 * before the scene builds; bundle `deferred` (worm, later audio stems and
 * eruption FX) background-loads during the first BETTING phase so the first
 * crash never blocks on IO.
 *
 * Placeholder tier: original code-authored SVGs in /public/assets — per
 * ART_AUDIO_DIRECTION §6, "the placeholder tier IS a milestone deliverable".
 * Real art swaps in by replacing files; the aliases are the stable contract.
 */
import { Assets, type AssetsManifest } from "pixi.js";

/** Rasterize SVGs at 2x so world sprites stay crisp on hi-dpi displays. */
const SVG_DATA = { resolution: 2 };

export const manifest: AssetsManifest = {
  bundles: [
    {
      name: "boot",
      assets: [
        { alias: "duneFar", src: "dune-far.svg", data: SVG_DATA },
        { alias: "duneMid", src: "dune-mid.svg", data: SVG_DATA },
        { alias: "duneNear", src: "dune-near.svg", data: SVG_DATA },
        { alias: "crawlerHull", src: "crawler-hull.svg", data: SVG_DATA },
        { alias: "crawlerTreads", src: "crawler-treads.svg", data: SVG_DATA },
        { alias: "crawlerDrill", src: "crawler-drill.svg", data: SVG_DATA },
        { alias: "cargoPod", src: "cargo-pod.svg", data: SVG_DATA },
      ],
    },
    {
      name: "deferred",
      assets: [{ alias: "wormMaw", src: "worm-maw.svg", data: SVG_DATA }],
    },
  ],
};

let booted: Promise<void> | null = null;

/**
 * Init + load the boot bundle. Idempotent because `Assets.init` may only run
 * once per page — React StrictMode double-mounts TremorGame in dev.
 */
export function loadBootAssets(): Promise<void> {
  booted ??= (async () => {
    await Assets.init({
      manifest,
      basePath: `${import.meta.env.BASE_URL}assets/`,
    });
    await Assets.loadBundle("boot");
  })();
  return booted;
}

let deferredQueued = false;

/** Fire-and-forget; TremorGame calls this when a BETTING phase is first observed. */
export function backgroundLoadDeferred(): void {
  if (deferredQueued) return;
  deferredQueued = true;
  Assets.backgroundLoadBundle("deferred");
}
