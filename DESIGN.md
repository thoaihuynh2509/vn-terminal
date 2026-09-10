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

   | Group | Tokens | Use |
   |---|---|---|
   | Ground | `bg-page` `bg-surface` `bg-surface-2` | grey page, white card, table head / hover wash |
   | Text | `text-ink` `text-ink-2` `text-muted` | body, secondary, tertiary |
   | Rules | `border-line` `border-axis` `bg-grid` | hairline, stronger rule, inset fill |
   | Direction | `text-up` `text-down` | only through `Delta` |
   | Accent | `text-accent` | links, eyebrows; also legal as a fill carrying white |
   | Gold | `bg-gold` `bg-gold-soft` `border-gold-line` `text-gold-ink` `bg-gold-hover` | highlight fills only |
   | Chrome | `bg-chrome` `bg-chrome-2` `text-chrome-ink` `text-chrome-ink-2` `border-chrome-line` `text-chrome-up` `text-chrome-down` | the near-black ticker bar and dark panels |
   | Button | `bg-btn` `text-btn-ink` `hover:bg-btn-hover` | the primary button and every "this one is on" state |

   Three pairings are fixed and must not be mixed: **gold fills carry
   `text-gold-ink` and never white**; **chrome surfaces carry `text-chrome-*`,
   because `text-ink-2` and `text-accent` are unreadable on them**; **`bg-btn`
   carries `text-btn-ink`, and inverts with the colour scheme** — never use
   `bg-chrome` for a button, it is a panel ground.
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
@/components/ui        Card Section StatTile Eyebrow CtaLink UpgradeBand DarkPanel LimitChip
@/components/chrome    SectionHead Thumb
@/components/editorial PageHeader Prose
@/components/Delta     Delta
@/components/Sparkline Sparkline
@/components/Heatmap   Heatmap HeatmapLegend
@/components/BreadthBar BreadthBar
@/components/SectorBars SectorBars
@/components/FeedBanner FeedBanner
@/components/QuoteTable GoldTable PriceChart WatchButton
```

- `CtaLink` is the only way to render a call to action: `gold` (the one paid
  action on a page), `primary` (chrome/inverting), `ghost`.
- `UpgradeBand` closes a gated block; `DarkPanel` is the "what you get when you
  pay" panel. Both take their copy from the dictionary like everything else.
- A **highlighted** card needs `card-featured`, not a `border-2` utility:
  `.card` is unlayered CSS and outranks Tailwind border utilities.

`Pills` and `Accordion` need `"use client"` only if you attach state; `Accordion`
is native `<details>` and works in a server component.

## Layout

- Page body: `<PageShell rail={...}>` for a right column, or `<PageShell>` alone.
- Vertical rhythm between blocks: `<Stack>`; never ad-hoc `mb-*` on siblings.
- Section headings: `<SectionHead title=... href=... viewAll={dict.common.viewAll} />`.
- Every page opens with `<PageHeader />` (no photo mastheads).
- Prose measure is capped at `max-w-[68ch]`. Never run body text full width.

## Type scale (do not invent sizes)

Two faces. **Be Vietnam Pro** carries every word; **IBM Plex Mono**
(`font-mono`) carries every *figure* — prices, deltas, volumes, axis labels —
and every uppercase micro-cap label. The design called for Sora, which ships no
Vietnamese subset (its Latin Extended stops short of U+1EA0–1EF9, so most
Vietnamese words would render half from a fallback); Be Vietnam Pro is the same
geometric register with the diacritics drawn in.

| Role | Class |
|---|---|
| Hero h1 | `text-[36px] sm:text-[44px] font-semibold leading-[1.1] tracking-[-0.03em]` |
| Page h1 | `text-[28px] sm:text-[34px] font-semibold tracking-[-0.03em]` |
| Section h2 | `text-[18px] font-semibold tracking-tight` |
| Hero figure | `font-mono text-[28px] font-medium tracking-tight` |
| Eyebrow / column head | `<Eyebrow>` — `font-mono text-[11px] uppercase tracking-[0.14em]` |
| Lede | `text-[16px] leading-relaxed text-ink-2` |
| Body | `text-[14px] leading-relaxed` |
| Table / dense | `text-[13px]`, figures `font-mono` |
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
