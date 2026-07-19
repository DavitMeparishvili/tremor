/**
 * Round state machine per SPECS.md §3 and plan §4.1.
 *
 * BETTING → ARMING → RUNNING → CRASHED → SETTLING → BETTING …
 *
 * No `setTimeout`/`setInterval`: every transition derives from `tick(nowMs)`
 * timestamps at nominal phase boundaries, so a throttled tab fast-forwards
 * through missed transitions on its next tick without drifting the cadence.
 */
import {
  ARMING_MS,
  AUTO_CASHOUT_MIN,
  BETTING_MS,
  CRASHED_MS,
  MAX_BET,
  MIN_BET,
  SETTLING_MS,
  STARTING_BALANCE,
} from "./constants";
import { multiplierAt } from "./curve";
import type { OutcomeProvider } from "./outcome";
import type { BetSlot, EngineEvent, RoundPhase, RoundSpec } from "./types";

export interface TremorEngine {
  /** Called every frame from the Pixi ticker with performance.now(). Drives ALL time. */
  tick(nowMs: number): void;
  /** Pure read; the live multiplier during "running", the crash point through "crashed"/"settling", else 1.00. */
  currentMultiplier(): number;
  /** Wallet snapshot; the demo wallet lives in the engine until M8 moves it server-side. */
  balance(): number;
  /** Cloned snapshots — safe to hand to React; engine internals are never exposed. */
  bets(): [BetSlot, BetSlot];
  placeBet(slot: 0 | 1, amount: number, autoCashout: number | null): void;
  requestCashout(slot: 0 | 1): void;
  on(listener: (e: EngineEvent) => void): () => void; // returns unsubscribe
}

export interface EngineOptions {
  provider: OutcomeProvider;
  initialBalance?: number;
}

export function createEngine(options: EngineOptions): TremorEngine {
  return new Engine(options.provider, options.initialBalance ?? STARTING_BALANCE);
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

function emptySlot(slot: 0 | 1): BetSlot {
  return { slot, state: "idle", amount: 0, autoCashout: null, cashedOutAt: null, payout: null };
}

class Engine implements TremorEngine {
  private wallet: number;
  private phase: RoundPhase = "betting";
  private started = false;
  /** Nominal end of the current phase; +Infinity while "running". */
  private phaseEndsAt = 0;
  private runStartedAt = 0;
  private spec: RoundSpec | null = null;
  private specToken = 0;
  private lastMultiplier = 1;
  private crashPoint: number | null = null;
  private pendingCrash: number | null = null;
  private slots: [BetSlot, BetSlot] = [emptySlot(0), emptySlot(1)];
  private readonly listeners = new Set<(e: EngineEvent) => void>();

  constructor(
    private readonly provider: OutcomeProvider,
    initialBalance: number,
  ) {
    this.wallet = round2(initialBalance);
    provider.onCrash((roundId, crashPoint) => {
      if (this.phase === "running" && this.spec?.roundId === roundId) {
        this.pendingCrash = crashPoint;
      }
    });
  }

  tick(nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    if (!this.started) {
      this.started = true;
      this.enterBetting(nowMs);
    }
    // Fast-forward: cascade through every nominal transition `nowMs` covers.
    let progressed = true;
    while (progressed) {
      progressed = false;
      if (this.phase === "running") {
        progressed = this.advanceRun(nowMs);
      } else if (nowMs >= this.phaseEndsAt) {
        switch (this.phase) {
          case "betting":
            this.enterPhase("arming", this.phaseEndsAt, ARMING_MS);
            progressed = true;
            break;
          case "arming":
            // Hold until the provider has resolved the round spec (instant
            // locally; M8 remote may lag). Cadence resumes from the nominal
            // boundary so hidden-tab fast-forwards stay drift-free.
            if (this.spec) {
              this.enterRunning(this.phaseEndsAt, this.spec);
              progressed = true;
            }
            break;
          case "crashed":
            this.enterPhase("settling", this.phaseEndsAt, SETTLING_MS);
            progressed = true;
            break;
          case "settling":
            this.enterBetting(this.phaseEndsAt);
            progressed = true;
            break;
        }
      }
    }
  }

  currentMultiplier(): number {
    if (this.phase === "running") return this.lastMultiplier;
    if (this.phase === "crashed" || this.phase === "settling") {
      return this.crashPoint ?? this.lastMultiplier;
    }
    return 1;
  }

  balance(): number {
    return this.wallet;
  }

  bets(): [BetSlot, BetSlot] {
    return [{ ...this.slots[0] }, { ...this.slots[1] }];
  }

  placeBet(slot: 0 | 1, amount: number, autoCashout: number | null): void {
    if (this.phase !== "betting") return this.rejectBet(slot, "phase");
    const stake = round2(amount);
    if (!Number.isFinite(stake) || stake < MIN_BET || stake > MAX_BET) {
      return this.rejectBet(slot, "limit");
    }
    if (autoCashout !== null && (!Number.isFinite(autoCashout) || autoCashout < AUTO_CASHOUT_MIN)) {
      return this.rejectBet(slot, "limit");
    }
    const bet = this.slots[slot];
    // Re-placing on an occupied slot adjusts the bet: refund, then charge.
    const refund = bet.state === "placed" ? bet.amount : 0;
    if (stake > this.wallet + refund) return this.rejectBet(slot, "balance");
    this.wallet = round2(this.wallet + refund - stake);
    bet.state = "placed";
    bet.amount = stake;
    bet.autoCashout = autoCashout;
    bet.cashedOutAt = null;
    bet.payout = null;
    this.emit({ type: "betAccepted", slot, amount: stake });
  }

  requestCashout(slot: 0 | 1): void {
    const bet = this.slots[slot];
    if (this.phase !== "running" || bet.state !== "live") return;
    this.beginCashout(bet);
  }

  on(listener: (e: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** One running-phase step. Returns true if the round crashed at this tick. */
  private advanceRun(nowMs: number): boolean {
    const spec = this.spec;
    if (!spec) return false; // unreachable: "running" requires a resolved spec
    const elapsed = Math.max(0, nowMs - this.runStartedAt);
    const m = multiplierAt(elapsed);
    this.lastMultiplier = m;
    this.provider.tick(spec.roundId, elapsed, m); // may fire onCrash synchronously
    if (this.pendingCrash !== null) {
      const crashPoint = this.pendingCrash;
      this.pendingCrash = null;
      this.crash(spec, crashPoint, nowMs);
      return true;
    }
    // No crash this frame ⇒ m is below the crash point; safe to trigger autos.
    for (const bet of this.slots) {
      if (bet.state === "live" && bet.autoCashout !== null && m >= bet.autoCashout) {
        this.beginCashout(bet);
      }
    }
    return false;
  }

  private crash(spec: RoundSpec, crashPoint: number, nowMs: number): void {
    this.crashPoint = crashPoint;
    this.lastMultiplier = crashPoint;
    // Player-favorable tie-break (SPECS §3): an auto target the nominal curve
    // reached at or before the crash point settles as a win — at its target —
    // even when target and crash landed inside the same frame.
    for (const bet of this.slots) {
      if (bet.state === "live" && bet.autoCashout !== null && bet.autoCashout <= crashPoint) {
        this.settle(bet, bet.autoCashout);
      }
    }
    for (const bet of this.slots) {
      if (bet.state === "placed" || bet.state === "live") bet.state = "busted";
    }
    this.emit({ type: "crashed", roundId: spec.roundId, crashPoint });
    this.enterPhase("crashed", nowMs, CRASHED_MS);
  }

  private beginCashout(bet: BetSlot): void {
    const spec = this.spec;
    if (!spec) return;
    bet.state = "cashingOut";
    this.provider.requestCashout(spec.roundId, bet.slot).then(
      ({ multiplier }) => {
        // The slot may have been re-created (new round) or already settled;
        // the state check confines the resolution to the original request.
        if (bet.state === "cashingOut") this.settle(bet, multiplier);
      },
      () => {
        // Provider authority said no (round over, M8 server rejection).
        if (bet.state === "cashingOut") bet.state = "busted";
      },
    );
  }

  private settle(bet: BetSlot, multiplier: number): void {
    const payout = round2(bet.amount * multiplier);
    bet.state = "cashedOut";
    bet.cashedOutAt = multiplier;
    bet.payout = payout;
    this.wallet = round2(this.wallet + payout);
    this.emit({ type: "cashedOut", slot: bet.slot, multiplier, payout });
  }

  private enterBetting(at: number): void {
    for (const bet of this.slots) {
      if (bet.state === "cashingOut") bet.state = "busted"; // orphan stragglers
    }
    this.slots = [emptySlot(0), emptySlot(1)];
    this.spec = null;
    this.crashPoint = null;
    this.pendingCrash = null;
    this.lastMultiplier = 1;
    this.enterPhase("betting", at, BETTING_MS);
    const token = ++this.specToken;
    this.provider.nextRound().then(
      (spec) => {
        if (token === this.specToken) this.spec = spec;
      },
      (err: unknown) => {
        if (token === this.specToken) {
          console.error("outcome provider failed to start a round", err);
        }
      },
    );
  }

  private enterRunning(at: number, spec: RoundSpec): void {
    this.runStartedAt = at;
    this.lastMultiplier = 1;
    for (const bet of this.slots) {
      if (bet.state === "placed") bet.state = "live";
    }
    this.emit({ type: "roundStarted", spec });
    this.enterPhase("running", at, null);
  }

  private enterPhase(phase: RoundPhase, at: number, durationMs: number | null): void {
    this.phase = phase;
    const endsAt = durationMs === null ? null : at + durationMs;
    this.phaseEndsAt = endsAt ?? Number.POSITIVE_INFINITY;
    this.emit({ type: "phaseChanged", phase, endsAt });
  }

  private rejectBet(slot: 0 | 1, reason: "phase" | "balance" | "limit"): void {
    this.emit({ type: "betRejected", slot, reason });
  }

  private emit(e: EngineEvent): void {
    for (const listener of this.listeners) listener(e);
  }
}
