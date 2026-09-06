import type { ReactNode } from "react";

/**
 * Page shells and layout primitives.
 *
 * Every page is built from these so spacing, measure and rail width stay
 * identical across the site. Page views must not hand-roll their own grid.
 */

/** Standard content page. `rail` opts into the 300px right column. */
export function PageShell({
  children,
  rail,
}: {
  children: ReactNode;
  rail?: ReactNode;
}) {
  if (!rail) return <div className="min-w-0">{children}</div>;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">{children}</div>
      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">{rail}</aside>
    </div>
  );
}

/** Vertical rhythm between major blocks. Use instead of ad-hoc margins. */
export function Stack({ children, gap = "lg" }: { children: ReactNode; gap?: "sm" | "md" | "lg" }) {
  const g = gap === "sm" ? "space-y-3" : gap === "md" ? "space-y-5" : "space-y-9";
  return <div className={g}>{children}</div>;
}

/** Rail panel — matches the sidebar treatment exactly. */
export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card p-3.5">
      {title && (
        <h2 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
          <span aria-hidden="true" className="h-1.5 w-1.5 rotate-45 bg-accent" />
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

/**
 * The one way to render a headline figure. Keeps hero numbers in the UI sans
 * with proportional figures, and the label/《delta》relationship consistent.
 */
export function Metric({
  label,
  value,
  delta,
  size = "md",
  aside,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  size?: "sm" | "md" | "lg";
  aside?: ReactNode;
}) {
  const v = size === "lg" ? "text-[32px]" : size === "sm" ? "text-[18px]" : "text-[24px]";
  return (
    <div className="card p-3.5">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className={`tnum font-semibold leading-none tracking-tight ${v}`}>{value}</div>
        {aside && <div className="shrink-0 pb-0.5">{aside}</div>}
      </div>
      {delta && <div className="mt-2 text-[12px]">{delta}</div>}
    </div>
  );
}

/** Empty / no-content state. Never leave a bare paragraph. */
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card px-4 py-12 text-center">
      <p className="text-[14px] font-medium">{title}</p>
      {body && <p className="mx-auto mt-1.5 max-w-[52ch] text-[13px] text-ink-2">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Segmented control — timeframe switches, view toggles. */
export function Pills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded px-2.5 py-1 text-[12px] font-medium transition-colors ${
            value === o.value ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Definition rows — fundamentals, assumptions, key/value blocks. */
export function KeyValue({ rows }: { rows: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map((r) => (
        <div key={r.k} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
          <dt className="text-[12px] text-ink-2">{r.k}</dt>
          <dd className="tnum shrink-0 text-[13px] font-medium">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Native disclosure — keyboard-operable with no JS. */
export function Accordion({ title, children, open = false }: { title: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="card group overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[14px] font-semibold hover:bg-surface-2">
        {title}
        <span aria-hidden="true" className="text-[11px] text-muted transition-transform group-open:rotate-180">▼</span>
      </summary>
      <div className="border-t border-line px-4 py-3.5">{children}</div>
    </details>
  );
}
