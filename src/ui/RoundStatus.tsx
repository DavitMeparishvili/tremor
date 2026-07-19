import { useEffect, useState } from "react";
import type { RoundPhase } from "../sim/types";
import { useTremorStore } from "../state/store";

const PHASE_LABEL: Record<RoundPhase, string> = {
  betting: "PLACE YOUR BETS",
  arming: "ARMING",
  running: "HARVESTING",
  crashed: "CRASHED",
  settling: "SETTLING",
};

/**
 * Countdown label for the betting/arming windows. Ticks on a plain
 * `setInterval`, decoupled from the 60fps sim ticker — this is a cosmetic
 * repaint of a low-frequency store field (`phaseEndsAt`), not the per-frame
 * `multiplier` field React is forbidden from selecting (SPECS §5).
 */
export function RoundStatus() {
  const phase = useTremorStore((s) => s.phase);
  const phaseEndsAt = useTremorStore((s) => s.phaseEndsAt);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (phaseEndsAt === null) return;
    const id = window.setInterval(() => forceTick((t) => t + 1), 100);
    return () => window.clearInterval(id);
  }, [phaseEndsAt]);

  const secondsLeft = phaseEndsAt === null ? null : Math.max(0, (phaseEndsAt - performance.now()) / 1000);

  return (
    <div className="pointer-events-none flex flex-col items-center gap-0.5 text-center">
      <span className="text-xs font-semibold tracking-[0.3em] text-white/70">{PHASE_LABEL[phase]}</span>
      {secondsLeft !== null && <span className="text-sm font-bold text-white">{secondsLeft.toFixed(1)}s</span>}
    </div>
  );
}
