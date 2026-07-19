import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary (M7). A render crash anywhere in the HUD tree
 * lands here instead of white-screening; the fallback offers a reload, which
 * is the only honest recovery for a game whose canvas/audio lifecycles are
 * tangled with the React tree. Note: this catches RENDER errors — async
 * failures (e.g. Pixi init) are handled locally by GameCanvas.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("TREMOR crashed outside the game fiction:", error, info.componentStack);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#0d0a08] p-6 text-center">
        <span className="text-sm font-bold uppercase tracking-[0.3em] text-[#FF4433]">
          Signal lost
        </span>
        <p className="max-w-sm text-sm text-white/60">
          Something broke outside the game. Your settings are saved; the demo wallet resets
          each session anyway.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded bg-[#35E0C8] px-4 py-1.5 text-sm font-bold text-black"
        >
          Reload
        </button>
        <code className="max-w-md break-all text-xs text-white/30">{this.state.error.message}</code>
      </div>
    );
  }
}
