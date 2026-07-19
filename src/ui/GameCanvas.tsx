import { useEffect, useRef, useState } from "react";
import { TremorGame } from "../game/TremorGame";

/**
 * Mounts the Pixi canvas. React owns the host div; Pixi owns everything inside
 * it. Async init failures (WebGL unavailable, asset load error) can't reach a
 * React error boundary, so they're caught here and rendered as a DOM fallback.
 */
export function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    const game = new TremorGame();
    const ready = game.init(host).catch((err: unknown) => {
      console.error("TremorGame failed to initialize:", err);
      if (!cancelled) setInitError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      // init is async: wait for it to settle before destroying (StrictMode double-mount safe)
      cancelled = true;
      void ready.finally(() => game.destroy());
    };
  }, []);

  return (
    <div ref={hostRef} className="absolute inset-0">
      {initError !== null && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
          <span className="text-sm font-bold uppercase tracking-[0.3em] text-[#FF4433]">
            Renderer offline
          </span>
          <p className="max-w-sm text-sm text-white/60">
            The game canvas failed to start — this usually means WebGL is unavailable or
            blocked in this browser.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded bg-[#35E0C8] px-4 py-1.5 text-sm font-bold text-black"
          >
            Retry
          </button>
          <code className="max-w-md break-all text-xs text-white/30">{initError}</code>
        </div>
      )}
    </div>
  );
}
