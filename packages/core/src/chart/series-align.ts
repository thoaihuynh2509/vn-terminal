/** Re-match a series aligned to one set of bars onto another by bar time; uncovered times become null. */
/** Whether the first `k` values of two series match, so a chart only needs sending the newest point. */
export function sameHead(
  a: readonly (number | null | undefined)[] | undefined, b: readonly (number | null | undefined)[], k: number,
): boolean {
  if (!a || k < 0 || a.length < k || b.length < k) return false;
  for (let i = 0; i < k; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

export function alignByTime(
  source: { t: number }[],
  series: (number | null)[],
  target: { t: number }[],
): (number | null)[] {
  const byT = new Map<number, number | null>();
  source.forEach((b, i) => byT.set(b.t, series[i] ?? null));
  return target.map((b) => byT.get(b.t) ?? null);
}
