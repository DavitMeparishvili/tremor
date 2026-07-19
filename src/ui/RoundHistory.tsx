import { useTremorStore } from "../state/store";

/** <2x dim, ≥10x hot — plan §4.5: "the genre's strongest one-more-round hook." */
function tierClass(crashPoint: number): string {
  if (crashPoint >= 10) return "bg-[#FF4433]/90 text-white";
  if (crashPoint >= 2) return "bg-white/15 text-white";
  return "bg-white/5 text-white/40";
}

/** Last ~HISTORY_LENGTH crash multipliers, most recent first (store already caps + orders this). */
export function RoundHistory() {
  const history = useTremorStore((s) => s.history);
  if (history.length === 0) return null;

  return (
    <div className="pointer-events-auto flex max-w-full gap-1.5 overflow-x-auto rounded bg-black/30 p-1.5">
      {history.map((r) => (
        <span
          key={`${r.roundId}:${r.nonce}`}
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${tierClass(r.crashPoint)}`}
        >
          {r.crashPoint.toFixed(2)}x
        </span>
      ))}
    </div>
  );
}
