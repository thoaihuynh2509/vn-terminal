# Page rebuild contract

Read this fully before editing. It is the design system; deviating from it makes
your page look like a different website.

## Hard rules

1. **Only edit the files you were assigned.** Never edit anything under
   `src/components/`, `src/lib/`, `src/content/`, `src/app/`, `globals.css`, or
   `DESIGN.md`. If you need a primitive that does not exist, compose it locally
   inside your own view file.
2. **No new dependencies.** No `npm install`.
3. **No raw colours.** Never write a hex, `rgb()`, or a Tailwind palette colour
   (`text-red-500`, `bg-slate-100`). Only these tokens exist:
   `bg-page bg-surface bg-surface-2 text-ink text-ink-2 text-muted
   text-up text-down text-accent border-line`.
4. **Never render a directional number yourself.** Import `Delta` from
   `@/components/Delta` for every change/percentage. It carries the ▲/▼ glyph and
   sign that make the colour legal for colourblind readers, and renders the flat
   case as a neutral dash. A bare coloured number is a bug.
5. **`tnum` class on every column of aligned figures** (tables, key/value rows).
   Never on standalone hero numbers.
6. **Any element with `overflow-x-auto` must also have `relative`.** Otherwise
   `.sr-only` spans inside escape and stretch the document — a real regression
   this project already shipped once.
7. **All user-visible text comes from the dictionary** (`getDict(locale)`).
   Never hardcode Vietnamese or English strings. Every key you need already
   exists; if one is genuinely missing, compose from existing keys.

## Use these primitives

```
@/components/layout    PageShell Stack Panel Metric EmptyState Pills KeyValue Accordion
@/components/ui        Card StatTile LimitChip Section
@/components/chrome    SectionHead Thumb
@/components/editorial PageHeader CategoryChip Avatar Byline ArticleCard Prose DemoBadge
@/components/Delta     Delta
@/components/Sparkline Sparkline
@/components/Heatmap   Heatmap HeatmapLegend
@/components/FeedBanner FeedBanner
@/components/QuoteTable GoldTable PriceChart WatchButton
```

`Pills` and `Accordion` need `"use client"` only if you attach state; `Accordion`
is native `<details>` and works in a server component.

## Layout

- Page body: `<PageShell rail={...}>` for a right column, or `<PageShell>` alone.
- Vertical rhythm between blocks: `<Stack>`; never ad-hoc `mb-*` on siblings.
- Section headings: `<SectionHead title=... href=... viewAll={dict.common.viewAll} />`.
- Every page opens with `<PageHeader />` (no photo mastheads).
- Prose measure is capped at `max-w-[68ch]`. Never run body text full width.

## Type scale (do not invent sizes)

| Role | Class |
|---|---|
| Hero figure | `text-[32px] font-semibold tracking-tight` |
| Page h1 | `text-[20px] font-semibold tracking-tight` |
| Brief headline | `text-[28px] font-semibold leading-tight tracking-tight` |
| Card title | `text-[16px] font-semibold` |
| Section label | `text-[11px] font-bold uppercase tracking-wider` |
| Body | `text-[14px] leading-relaxed` |
| Table / dense | `text-[13px]` |
| Meta | `text-[12px] text-muted` |

## Data handling

- Fetch with `Promise.allSettled`; one dead feed degrades only its own section.
- On failure render `<FeedBanner dict={dict} detail={...} />` — **never render a
  missing value as `0` or `—` as if it were real data.**
- Do not call `notFound()` because a feed threw. 404 means the thing does not
  exist; a broken feed is a degraded state.

## Accessibility (a suite enforces all of this)

- Exactly **one `<h1>`** per page. No skipped heading levels (h1→h3 fails).
- Every `<table>` needs a `<caption>` (use `className="sr-only"`).
- Every button and link needs an accessible name; every `<img>` needs `alt` (decorative → `alt=""`).
- No positive `tabIndex`. No horizontal page overflow.
- `<svg role="img">` needs `aria-label`.

## Definition of done

`npx tsc --noEmit` passes with zero errors in the files you touched, and you
report exactly which files you changed. Do not run `npm run build` or start a
server — the orchestrator does integration.
