import { BetPanel } from "./ui/BetPanel";
import { GameCanvas } from "./ui/GameCanvas";
import { MuteToggle } from "./ui/MuteToggle";
import { ResultsToast } from "./ui/ResultsToast";
import { RoundHistory } from "./ui/RoundHistory";
import { RoundStatus } from "./ui/RoundStatus";
import { SettingsModal } from "./ui/SettingsModal";

export default function App() {
  return (
    <div className="relative h-full w-full">
      <GameCanvas />

      {/* HUD shell (DOM) — low-frequency UI only; never per-frame data.
          Horizontal padding keeps the column clear of the Pixi radar (top-left)
          and FPS readout (top-right) on narrow portrait screens. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] px-20 sm:px-2">
        <span className="whitespace-nowrap rounded bg-black/40 px-3 py-1 text-center text-[10px] font-semibold tracking-[0.2em] text-[#FF4433] sm:text-xs">
          TREMOR — DEMO / SIMULATED
        </span>
        <RoundStatus />
        <RoundHistory />
      </div>

      {/* Below the Pixi FPS readout, which owns the very corner */}
      <div className="absolute right-2 top-8 flex gap-1 pr-[env(safe-area-inset-right)]">
        <MuteToggle />
        <SettingsModal />
      </div>

      <ResultsToast />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto w-full max-w-2xl">
          <BetPanel />
        </div>
      </div>
    </div>
  );
}
