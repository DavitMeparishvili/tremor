import { useEffect, useRef } from "react";
import { TremorGame } from "../game/TremorGame";

/** Mounts the Pixi canvas. React owns the host div; Pixi owns everything inside it. */
export function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const game = new TremorGame();
    const ready = game.init(host);

    return () => {
      // init is async: wait for it to settle before destroying (StrictMode double-mount safe)
      void ready.finally(() => game.destroy());
    };
  }, []);

  return <div ref={hostRef} className="absolute inset-0" />;
}
