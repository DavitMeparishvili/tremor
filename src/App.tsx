import { BetPanel } from "./ui/BetPanel";
import { GameCanvas } from "./ui/GameCanvas";
import { MuteToggle } from "./ui/MuteToggle";
import { ResultsToast } from "./ui/ResultsToast";
import { RoundHistory } from "./ui/RoundHistory";
import { RoundStatus } from "./ui/RoundStatus";

export default function App() {
  return (
    <div className="relative h-full w-full">
      <GameCanvas />

      {/* HUD shell (DOM) — low-frequency UI only; never per-frame data */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-2 p-2">
        <span className="rounded bg-black/40 px-3 py-1 text-xs font-semibold tracking-[0.2em] text-[#FF4433]">
          TREMOR — DEMO / SIMULATED
        </span>
        <RoundStatus />
        <RoundHistory />
      </div>

      {/* Below the Pixi FPS readout, which owns the very corner */}
      <div className="absolute right-2 top-8">
        <MuteToggle />
      </div>

      <ResultsToast />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
        <div className="pointer-events-auto w-full max-w-2xl">
          <BetPanel />
        </div>
      </div>
    </div>
  );
}
