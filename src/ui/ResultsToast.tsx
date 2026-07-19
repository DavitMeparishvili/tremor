import { useEffect, useRef, useState } from "react";
import type { BetSlot } from "../sim/types";
import { useTremorStore } from "../state/store";

interface Toast {
  id: number;
  kind: "win" | "bust";
  text: string;
}

const TOAST_MS = 3200;

/** Win/bust card (plan M2): fires once per bet-slot settle, not per frame — diffs `bets` on change. */
export function ResultsToast() {
  const bets = useTremorStore((s) => s.bets);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prevRef = useRef<[BetSlot, BetSlot] | null>(null);
  const idRef = useRef(0);
  const timersRef = useRef<number[]>([]);

  // Timers live across bets changes — clearing them in the diff effect's
  // cleanup would cancel dismissal on every bet/phase update, leaving toasts
  // stuck on screen forever. Only unmount clears them.
  useEffect(() => () => timersRef.current.forEach(window.clearTimeout), []);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = bets;
    if (!prev) return; // first mount: nothing to diff against yet

    const additions: Toast[] = [];
    bets.forEach((bet, i) => {
      const was = prev[i];
      if (bet.state === "cashedOut" && was.state !== "cashedOut") {
        additions.push({
          id: ++idRef.current,
          kind: "win",
          text: `Slot ${i + 1}: won ${(bet.payout ?? 0).toFixed(2)} @ ${(bet.cashedOutAt ?? 0).toFixed(2)}x`,
        });
      } else if (bet.state === "busted" && was.state !== "busted") {
        additions.push({
          id: ++idRef.current,
          kind: "bust",
          text: `Slot ${i + 1}: busted — lost ${bet.amount.toFixed(2)}`,
        });
      }
    });
    if (additions.length === 0) return;

    // Cap at the 2 most recent (one per slot): stale results would otherwise
    // pile up over the play area on small screens. Timers for evicted toasts
    // fire harmlessly — their id is already gone from the list.
    setToasts((t) => [...t, ...additions].slice(-2));
    timersRef.current.push(
      ...additions.map((toast) =>
        window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toast.id)), TOAST_MS),
      ),
    );
  }, [bets]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none flex flex-col items-center gap-1">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded px-3 py-1.5 text-sm font-semibold shadow ${
            toast.kind === "win" ? "bg-[#35E0C8]/90 text-black" : "bg-[#FF4433]/90 text-white"
          }`}
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}
