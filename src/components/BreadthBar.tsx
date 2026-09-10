/**
 * Market breadth as a single bar — advancers vs decliners vs unchanged.
 *
 * The mood of a session at a glance, which a table of numbers does not give.
 * Fills use `bg-current` under `text-up`/`text-down`, so the colour is the
 * validated up/down token, never a raw hex; the counts are printed alongside so
 * the bar is not the only carrier of meaning (colourblind-safe).
 */
export function BreadthBar({
  up,
  down,
  flat,
  labels,
  showCounts = true,
}: {
  up: number;
  down: number;
  flat: number;
  labels: { up: string; down: string; flat: string };
  /** Off where the counts are already printed beside the bar. The bar keeps
      its `aria-label`, so nothing is lost to a screen reader either way. */
  showCounts?: boolean;
}) {
  const total = Math.max(1, up + down + flat);
  const pctOf = (n: number) => `${(n / total) * 100}%`;
  const aria = `${up} ${labels.up}, ${down} ${labels.down}, ${flat} ${labels.flat}`;

  return (
    <div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-grid"
        role="img"
        aria-label={aria}
      >
        <div className="text-up" style={{ width: pctOf(up) }}>
          <div className="h-full bg-current" />
        </div>
        <div className="text-down" style={{ width: pctOf(down) }}>
          <div className="h-full bg-current" />
        </div>
      </div>
      {showCounts && (
        <div className="tnum mt-2 flex justify-between font-mono text-[12px]" aria-hidden="true">
          <span className="text-up">▲ {up} {labels.up}</span>
          {flat > 0 && <span className="text-muted">— {flat} {labels.flat}</span>}
          <span className="text-down">▼ {down} {labels.down}</span>
        </div>
      )}
    </div>
  );
}
