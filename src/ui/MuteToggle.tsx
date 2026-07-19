import { useTremorStore } from "../state/store";

/**
 * Mute toggle (M6). Flips `settings.muted` in the store; the AudioDirector
 * observes the flag each frame via TremorGame and applies `Howler.mute` — the
 * React side never touches Howler (store is the only bridge, SPECS §5).
 * Persistence of the setting lands in M7 with the rest of the settings work.
 */
export function MuteToggle() {
  const muted = useTremorStore((s) => s.settings.muted);
  const setSetting = useTremorStore((s) => s.setSetting);

  return (
    <button
      type="button"
      onClick={() => setSetting("muted", !muted)}
      aria-label={muted ? "Unmute sound" : "Mute sound"}
      aria-pressed={muted}
      title={muted ? "Unmute" : "Mute"}
      className="rounded bg-black/40 px-2 py-1 text-sm leading-none text-[#35E0C8] transition-colors hover:bg-black/60"
    >
      {muted ? "\u{1F507}" : "\u{1F50A}"}
    </button>
  );
}
