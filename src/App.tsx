import { GameCanvas } from "./ui/GameCanvas";

export default function App() {
  return (
    <div className="relative h-full w-full">
      <GameCanvas />

      {/* HUD shell (DOM) — low-frequency UI only; never per-frame data */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-2">
        <span className="rounded bg-black/40 px-3 py-1 text-xs font-semibold tracking-[0.2em] text-[#FF4433]">
          TREMOR — DEMO / SIMULATED
        </span>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs text-white/40">
        <kbd className="rounded border border-white/20 px-1">B</kbd> bet 10 ·{" "}
        <kbd className="rounded border border-white/20 px-1">A</kbd> bet 10
        (auto 2x) · <kbd className="rounded border border-white/20 px-1">C</kbd>{" "}
        cash out · <kbd className="rounded border border-white/20 px-1">S</kbd>{" "}
        shake
      </div>
    </div>
  );
}
