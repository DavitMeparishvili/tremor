import { verifyCrashPoint } from "../sim/verify";
import type { RoundResult } from "../sim/types";
import { Modal } from "./Modal";

/**
 * Verify-round modal (M7, plan §4.2): replays a finished round's crash point
 * from its public {seed, nonce} via sim/verify and compares it to the recorded
 * result. When the M8 backend lands only the verify kernel changes (HMAC of
 * server/client seeds) — this UI survives the swap.
 */
export function VerifyRoundModal({ round, onClose }: { round: RoundResult; onClose: () => void }) {
  const recomputed = verifyCrashPoint(round.seed, round.nonce);
  const match = recomputed === round.crashPoint;

  return (
    <Modal title="Verify round" onClose={onClose}>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-white/40">Seed</dt>
          <dd className="break-all font-mono text-white/90">{round.seed}</dd>
        </div>
        <div className="flex gap-6">
          <span>
            <dt className="text-xs uppercase tracking-wide text-white/40">Nonce</dt>
            <dd className="font-mono text-white/90">{round.nonce}</dd>
          </span>
          <span>
            <dt className="text-xs uppercase tracking-wide text-white/40">Recorded crash</dt>
            <dd className="font-mono text-white/90">{round.crashPoint.toFixed(2)}x</dd>
          </span>
          <span>
            <dt className="text-xs uppercase tracking-wide text-white/40">Replayed crash</dt>
            <dd className="font-mono text-white/90">{recomputed.toFixed(2)}x</dd>
          </span>
        </div>
      </dl>

      <div
        className={`mt-3 rounded p-2 text-center text-sm font-bold ${
          match ? "bg-[#35E0C8]/20 text-[#35E0C8]" : "bg-[#FF4433]/20 text-[#FF4433]"
        }`}
      >
        {match ? "✓ Verified — replay matches the recorded result" : "✗ MISMATCH — replay disagrees"}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-white/40">
        The crash point is <span className="font-mono">crashPointFromUniform(seedrandom(seed:nonce)())</span>,
        computed before the round runs. Same seed and nonce always replay the same result —
        the theater you saw on screen never knew this number.
      </p>
    </Modal>
  );
}
