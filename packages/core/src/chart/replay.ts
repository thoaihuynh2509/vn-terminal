/** Bar replay: the chart as it stood at an earlier bar, stepped forward one bar at a time. */
export interface Replay {
  /** Time of the last bar shown, so older history paged in underneath does not move it. */
  t: number;
  playing: boolean;
  /** Bars per second while playing. */
  speed: number;
}

export const REPLAY_SPEEDS = [1, 3, 10] as const;

type Timed = { t: number };

/** Index of the last bar at or before `t`; 0 when every bar is later. */
export function replayIndex(bars: readonly Timed[], t: number): number {
  let lo = 0, hi = bars.length - 1, at = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= t) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return at;
}

/** A replay from the bar at `t`, clamped so at least one bar is shown and one is left to play. */
export function startReplay(bars: readonly Timed[], t: number): Replay | null {
  if (bars.length < 2) return null;
  const at = Math.min(bars.length - 2, replayIndex(bars, t));
  return { t: bars[at].t, playing: false, speed: REPLAY_SPEEDS[0] };
}

/** One bar further; a replay that reaches the last bar stops playing rather than running off the end. */
export function stepReplay(r: Replay, bars: readonly Timed[], by = 1): Replay {
  if (!bars.length) return r;
  const at = Math.min(bars.length - 1, replayIndex(bars, r.t) + by);
  return { ...r, t: bars[at].t, playing: r.playing && at < bars.length - 1 };
}

export function isReplayDone(r: Replay, bars: readonly Timed[]): boolean {
  return replayIndex(bars, r.t) >= bars.length - 1;
}

/** The bars the chart shows during a replay. */
export function replayBars<T extends Timed>(bars: T[], r: { t: number } | null): T[] {
  return r ? bars.slice(0, replayIndex(bars, r.t) + 1) : bars;
}
