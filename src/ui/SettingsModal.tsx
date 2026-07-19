import { useState } from "react";
import { useTremorStore } from "../state/store";
import { Modal } from "./Modal";

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded border border-white/10 bg-black/30 p-3">
      <span>
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="block text-xs text-white/50">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 accent-[#35E0C8]"
      />
    </label>
  );
}

/**
 * Settings (M7): reduced motion + sound, persisted by the store (SPECS §8).
 * The gear button lives next to the mute toggle; the modal is plain DOM.
 */
export function SettingsModal() {
  const [open, setOpen] = useState(false);
  const settings = useTremorStore((s) => s.settings);
  const setSetting = useTremorStore((s) => s.setSetting);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Settings"
        title="Settings"
        className="touch-manipulation rounded bg-black/40 px-2 py-1 text-sm leading-none text-[#35E0C8] transition-colors hover:bg-black/60"
      >
        {"⚙"}
      </button>

      {open && (
        <Modal title="Settings" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-2">
            <ToggleRow
              label="Reduced motion"
              hint="Disables screen shake, hit-stop and flash"
              checked={settings.reducedMotion}
              onChange={(v) => setSetting("reducedMotion", v)}
            />
            <ToggleRow
              label="Sound"
              hint="All music stems and effects"
              checked={!settings.muted}
              onChange={(v) => setSetting("muted", !v)}
            />
            <p className="mt-1 text-xs leading-relaxed text-white/40">
              Provably fair (demo): every crash point derives from a public seed and round
              nonce fixed before the round starts. Tap any round in the history bar to
              replay its math and verify the result.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
