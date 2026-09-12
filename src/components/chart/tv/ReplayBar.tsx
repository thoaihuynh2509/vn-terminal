"use client";

import { REPLAY_SPEEDS, type Replay } from "@/lib/chart/replay";

export interface ReplayLabels {
  toolbar: string;
  pick: string;
  play: string;
  pause: string;
  step: string;
  speed: string;
  exit: string;
}

const icon = { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.4, "aria-hidden": true } as const;
const btn = "grid h-8 min-w-8 place-items-center rounded-md px-1.5 text-[12px] hover:bg-tv-hover disabled:opacity-40";

/** TradingView's replay strip: choose where to start, then play the chart forward bar by bar. */
export function ReplayBar({ labels, replay, picking, done, onPick, onToggle, onStep, onSpeed, onExit }: {
  labels: ReplayLabels;
  replay: Replay | null;
  picking: boolean;
  done: boolean;
  onPick: () => void;
  onToggle: () => void;
  onStep: () => void;
  onSpeed: (speed: number) => void;
  onExit: () => void;
}) {
  return (
    <div role="toolbar" aria-label={labels.toolbar}
      className="absolute bottom-10 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-tv-border bg-tv-bg p-1 text-tv-text shadow-xl">
      <button type="button" onClick={onPick} aria-pressed={picking} title={labels.pick} aria-label={labels.pick}
        className={`${btn} ${picking ? "text-tv-accent-text" : ""}`}>
        <svg {...icon}><path d="M10 2v16M5 6l5 4 5-4" /></svg>
      </button>
      <button type="button" onClick={onToggle} disabled={!replay || done} aria-label={replay?.playing ? labels.pause : labels.play} className={btn}>
        {replay?.playing
          ? <svg {...icon}><path d="M7 4v12M13 4v12" /></svg>
          : <svg {...icon}><path d="M6 4l10 6-10 6z" /></svg>}
      </button>
      <button type="button" onClick={onStep} disabled={!replay || done} aria-label={labels.step} title={labels.step} className={btn}>
        <svg {...icon}><path d="M5 4l8 6-8 6zM15 4v12" /></svg>
      </button>
      <div role="group" aria-label={labels.speed} className="flex">
        {REPLAY_SPEEDS.map((sp) => (
          <button key={sp} type="button" aria-pressed={replay?.speed === sp} disabled={!replay} onClick={() => onSpeed(sp)}
            className={`${btn} tnum ${replay?.speed === sp ? "text-tv-accent-text" : ""}`}>
            {sp}x
          </button>
        ))}
      </div>
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-tv-border" />
      <button type="button" onClick={onExit} aria-label={labels.exit} title={labels.exit} className={btn}>
        <svg {...icon}><path d="M4 10h12M11 5l5 5-5 5" /></svg>
      </button>
    </div>
  );
}
