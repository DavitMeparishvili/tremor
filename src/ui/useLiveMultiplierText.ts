import { useEffect, useRef } from "react";
import { useTremorStore } from "../state/store";

/**
 * Writes formatted multiplier text straight into a DOM node via a ref,
 * bypassing React's render cycle entirely. SPECS §5 forbids React components
 * from *selecting* the transient `multiplier` field (that would re-render 60
 * times a second); this instead subscribes directly to the store — the same
 * pattern Pixi systems use — so the cash-out button's live label updates
 * every frame without the component itself ever re-rendering.
 */
export function useLiveMultiplierText<T extends HTMLElement>(format: (multiplier: number) => string) {
  const ref = useRef<T | null>(null);
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    return useTremorStore.subscribe(
      (s) => s.multiplier,
      (m) => {
        if (ref.current) ref.current.textContent = formatRef.current(m);
      },
      { fireImmediately: true },
    );
  }, []);

  return ref;
}
