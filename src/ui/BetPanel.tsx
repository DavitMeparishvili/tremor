import { useState } from "react";
import { chipRateFor, chipTick } from "../audio/uiSfx";
import { AUTO_CASHOUT_MIN, MAX_BET, MIN_BET } from "../sim/constants";
import type { BetSlot } from "../sim/types";
import { useTremorStore } from "../state/store";
import { useLiveMultiplierText } from "./useLiveMultiplierText";

const QUICK_CHIPS = [10, 50, 100, 500];

function clampAmount(n: number): number {
  if (!Number.isFinite(n)) return MIN_BET;
  return Math.min(MAX_BET, Math.max(MIN_BET, Math.round(n)));
}

function stateLabel(bet: BetSlot): string {
  switch (bet.state) {
    case "idle":
      return "Idle";
    case "placed":
      return "Placed";
    case "live":
      return "Live";
    case "cashingOut":
      return "Cashing out…";
    case "cashedOut":
      return "Cashed out";
    case "busted":
      return "Busted";
  }
}

function BetSlotPanel({ slot }: { slot: 0 | 1 }) {
  const bet = useTremorStore((s) => s.bets[slot]);
  const phase = useTremorStore((s) => s.phase);
  const balance = useTremorStore((s) => s.balance);
  const placeBet = useTremorStore((s) => s.placeBet);
  const cashout = useTremorStore((s) => s.cashout);

  const [amount, setAmount] = useState(10);
  const [autoInput, setAutoInput] = useState("");

  // Live "CASH OUT @ m — payout" label: a direct store subscription (never a
  // React selector on `multiplier`, per SPECS §5) so this never re-renders the panel.
  const cashoutRef = useLiveMultiplierText<HTMLSpanElement>(
    (m) => `CASH OUT @ ${m.toFixed(2)}x — ${(bet.amount * m).toFixed(2)}`,
  );

  const editable = phase === "betting" && bet.state !== "cashingOut";
  const parsedAuto = autoInput.trim() === "" ? null : Number(autoInput);
  const autoValid = parsedAuto === null || (Number.isFinite(parsedAuto) && parsedAuto >= AUTO_CASHOUT_MIN);
  const amountValid = Number.isFinite(amount) && amount >= MIN_BET && amount <= MAX_BET;
  // Re-placing on an occupied slot refunds the old stake first (engine rule) — mirror that here.
  const refund = bet.state === "placed" ? bet.amount : 0;
  const affordable = amount <= balance + refund;
  const canSubmit = editable && amountValid && autoValid && affordable;

  const submit = () => {
    if (!canSubmit) return;
    placeBet(slot, amount, parsedAuto);
  };

  const showInputs = bet.state === "idle" || bet.state === "placed";
  const showCashout = bet.state === "live" || bet.state === "cashingOut";

  return (
    <div className="flex flex-1 flex-col gap-2 rounded-md border border-white/10 bg-black/30 p-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-white/50">
        <span>Slot {slot + 1}</span>
        <span>{stateLabel(bet)}</span>
      </div>

      {showInputs && (
        <>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={MIN_BET}
              max={MAX_BET}
              value={amount}
              disabled={!editable}
              onChange={(e) => setAmount(clampAmount(Number(e.target.value)))}
              className="w-20 rounded bg-white/10 px-2 py-1 text-sm text-white disabled:opacity-40"
            />
            <input
              type="number"
              placeholder="auto x"
              step={0.01}
              min={AUTO_CASHOUT_MIN}
              value={autoInput}
              disabled={!editable}
              onChange={(e) => setAutoInput(e.target.value)}
              className="w-20 rounded bg-white/10 px-2 py-1 text-sm text-white placeholder:text-white/30 disabled:opacity-40"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                disabled={!editable}
                onClick={() => {
                  setAmount(clampAmount(chip));
                  chipTick(chipRateFor(chip));
                }}
                className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/80 hover:bg-white/20 disabled:opacity-40"
              >
                {chip}
              </button>
            ))}
            <button
              type="button"
              disabled={!editable}
              onClick={() => {
                setAmount((a) => clampAmount(a / 2));
                chipTick(0.92); // halving ticks down…
              }}
              className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/80 hover:bg-white/20 disabled:opacity-40"
            >
              1/2
            </button>
            <button
              type="button"
              disabled={!editable}
              onClick={() => {
                setAmount((a) => clampAmount(a * 2));
                chipTick(1.12); // …doubling ticks up
              }}
              className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/80 hover:bg-white/20 disabled:opacity-40"
            >
              2x
            </button>
          </div>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="rounded bg-[#35E0C8] py-1.5 text-sm font-bold text-black disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            {bet.state === "placed" ? `Update Bet ${amount}` : `Place Bet ${amount}`}
          </button>
        </>
      )}

      {showCashout && (
        <button
          type="button"
          disabled={bet.state !== "live"}
          onClick={() => cashout(slot)}
          className="rounded bg-[#FF4433] py-2 text-sm font-bold text-white disabled:opacity-60"
        >
          <span ref={cashoutRef}>CASH OUT</span>
        </button>
      )}

      {bet.state === "cashedOut" && (
        <div className="rounded bg-[#35E0C8]/20 py-2 text-center text-sm font-semibold text-[#35E0C8]">
          Won {(bet.payout ?? 0).toFixed(2)} @ {(bet.cashedOutAt ?? 0).toFixed(2)}x
        </div>
      )}

      {bet.state === "busted" && (
        <div className="rounded bg-[#FF4433]/20 py-2 text-center text-sm font-semibold text-[#FF4433]">
          Busted — lost {bet.amount.toFixed(2)}
        </div>
      )}
    </div>
  );
}

/** Two independent bet slots (plan §4.5): hedge play — one auto-cashout early, one rides. */
export function BetPanel() {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-black/50 p-3 backdrop-blur sm:flex-row">
      <BetSlotPanel slot={0} />
      <BetSlotPanel slot={1} />
    </div>
  );
}
