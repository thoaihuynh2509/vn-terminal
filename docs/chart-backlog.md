# Chart backlog — stories to improve `ChartPro`

Written after a live pass over `/vi/bieu-do/VNM` on the dev server (2026-09-09) with
`npm run verify` green (typecheck · lint · unit · build, exit 0) and `npm run test:a11y`
15/15. Every story below cites what was actually observed, not what might be nice.

Ranked by value ÷ effort. **Owner: Build** = doable in-repo now. **Owner: You** = needs
an account, a key, or a pricing call first.

---

## C1 — The drawing rail tells anonymous readers the wrong price ✅ SHIPPED
**Owner: Build · S · conversion**

> As a first-time visitor, I want the locked drawing tools to tell me that signing up
> free unlocks them, so that I take the step that actually exists.

**Evidence.** Every locked tool button on an anon chart is labelled
`"Công cụ vẽ thuộc gói Pro"` / `"Drawing tools are a Pro feature"`
(`packages/core/src/i18n/index.ts:195,741`, used at `src/components/chart/ChartPro.tsx:1266-1267`).
Both strings now read "sign in — free" instead.
That is false: `GRANTS.free` includes `chart:drawings`
(`packages/core/src/auth/entitlement.ts`), and the module's own comment says drawings
are deliberately open to free because "a reader who never comes back never buys
anything". `GateHint` already gets this right — it sends `tier === "anon"` to login, not
to pricing. The rail is the one surface still quoting a Pro price for a free feature.

**Acceptance**
- An anon reader's locked tool reads "sign in to draw" (vi + en) and links to `/[locale]/login`.
- A `free` reader sees no lock on the rail at all (already true; add a regression test).
- The Pro-tier wording survives only where something is genuinely Pro (multi-chart).
- `chart_limit_hit` / `upgrade_prompt_shown` still fire with `gate: "drawing"`.

**Why first.** It is a copy change that stops the funnel quoting a paywall in front of
the free tier — the same class of self-contradiction the last commit set out to remove.

---

## C2 — Locked tools are invisible to keyboard and screen-reader readers ✅ SHIPPED
**Owner: Build · S · conversion + a11y**

> As a keyboard user, I want to reach a locked tool and hear why it is locked, so that
> the upgrade path is offered to me too.

**Evidence.** 11 of the 12 rail buttons rendered `disabled` for anon
(`ChartPro.tsx:1264`). A `disabled` button is not focusable, so the tooltip and the
`aria-label` that carry the entire upsell are unreachable without a mouse. All 11 also
collapse to the same `🔒` glyph, so the reader cannot tell a Fibonacci tool from a
text note — the thing being sold is unidentifiable. `test:a11y` passes because it
counts unnamed buttons, not unreachable ones.

**Acceptance**
- Locked tools use `aria-disabled` + no-op activation instead of `disabled`; they are tabbable.
- Activating a locked tool shows the existing `GateHint` rather than silently doing nothing.
- The tool's own glyph stays; the lock becomes a badge, not a replacement.
- A `verify-runtime` pass confirms tab order reaches every tool.

---

## C3 — Foreign net buy/sell (khối ngoại) is built and dark
**Owner: You (SSI keys) → Build · M · differentiation**

> As a VN equity holder, I want to see foreign net buying under the price, so that I
> can read the one flow signal that moves HOSE and that global tools do not show.

**Evidence.** `packages/core/src/providers/ssi.ts` implements the official SSI FCData
client, `parseForeign` computes net = buy − sell, and `ssi.test.ts` covers it. It has
**zero consumers** — no API route, no chart pane, nothing under `src/` imports it. The
roadmap lists this as a P1 differentiator marked "pending: confirm a data source
exists"; the source exists and the parser is written. It fails closed with no
credentials, so the only blocker is `SSI_CONSUMER_ID` / `SSI_CONSUMER_SECRET`.

**Acceptance**
- `/api/foreign?symbol=` returns the parsed daily series; absent keys ⇒ 501, never a fake zero.
- A signed histogram pane below volume, reusing `signedBarPaths` from `chart/paths.ts`.
- Verified against one live SSI response before shipping — the field names in that file
  are from the published schema, not from a real call (the file says so).
- Gated at `plus` and named on the pricing page, or free and named as the VN edge — **your call**.

**Why.** This is the roadmap's own answer to "why not TradingView", and most of it is
already paid for.

---

## C4 — Hydration mismatch on the chart's pane divider ✅ SHIPPED
**Owner: Build · S · quality**

> As any reader, I want the chart to render once, so that the first paint is not
> discarded and re-done.

**Evidence.** Every chart load logs a React hydration error: the divider's
`aria-valuenow` is `34` from the server and `43` on the client, because the pane ratio
is restored from `localStorage` after hydration. Reproduced in Chrome console on
`/vi/bieu-do/VNM`; it is the "1 Issue" badge the dev overlay shows.

**Acceptance**
- No hydration warning in the console on a cold load of the chart, stored ratio or not.
- The reader's saved pane ratio still applies (assert save → reload → read-back).
- Restore happens in an effect, or the SSR value is suppressed — not by dropping the feature.

---

## C5 — Draw a level, arm the alert from it
**Owner: Build · M · retention**

> As a holder who has drawn a support line, I want to turn it into a price alert in one
> action, so that my chart work keeps working while the tab is closed.

**Evidence.** Both halves exist and never meet: `chart/drawings.ts` has `hline` with a
price, and `AlertPanel` in the rail creates alerts against a price the reader retypes.
`alerts:email` is the paid capability the entitlement file names as the "REACH" half of
the paid line — this story is the most natural place to sell it, at the exact moment
the reader has demonstrated they care about a level.

**Acceptance**
- A horizontal line offers "alert here"; the alert is created at that price.
- Free readers get it in-tab (their 3-alert cap applies); the email upsell appears once, via `GateHint`.
- Deleting the drawing does not silently delete the alert.

---

## C6 — Name the corporate-event markers
**Owner: Build · S · comprehension**

> As a reader, I want to know what the small glyph on the time axis means, so that I
> trust the chart instead of ignoring a mark I cannot read.

**Evidence.** `chart/events.ts` places dividend / stock-dividend / rights markers and a
`ⓓ` glyph is visible on the VNM chart, but there is no legend. The module's own header
is careful that a marker "explains NOTHING about a drop" — that nuance never reaches the
reader, who is left to invent a meaning.

**Acceptance**
- A legend row (or first-hover tooltip) states kind + amount + ex-date, with no causal wording.
- Markers are keyboard-reachable and appear in the "view as table" alternative.

---

## C7 — Anonymous readers arrive already at their indicator cap
**Owner: You (funnel call) → Build · S · experiment**

> As a first-time visitor, I want to try one indicator of my own choosing, so that I
> experience the product before I am asked for anything.

**Evidence.** `INDICATOR_LIMIT.anon = 1`, and the chart auto-applies `?ind=sma20` on
arrival — the header reads `1/1` before the reader has touched anything. RSI, the only
other `free: true` indicator, is unreachable without first removing SMA. The first
interaction an anon reader has with the indicator menu is a wall.

**Acceptance (as an experiment, not a fix)**
- Variant: `anon = 2`, or the default SMA does not count against the cap.
- Measure `upgrade_prompt_shown{gate:"indicator"}` → signup rate against control.
- Ship whichever wins; leave it at 1 if the wall converts better.

**Note.** This may be working exactly as intended — the wall *is* the funnel. It is
listed as a measurable question, not a defect.

---

## C8 — Relative-strength mode for the compare overlay
**Owner: Build · M · differentiation**

> As a holder, I want to see my stock as a ratio against VNINDEX, so that I can tell
> whether it is leading or just riding the market.

**Evidence.** `chart/compare.ts` was widened past VNINDEX to sector peers and the
`%`-scale mode exists in `chart/scale.ts`, but an overlay of two normalised lines still
makes the reader do the division by eye. The roadmap asks for a "VNINDEX-relative
overlay", which is the ratio, not the overlay.

**Acceptance**
- A ratio mode plots `close(symbol) / close(index)`, rebased to 100 at the window's left edge.
- Rebases on pan/zoom so the visible window always starts at 100.
- Respects `COMPARE_LIMIT`; unavailable to `anon`/`free` exactly as compare is today.

---

---

## Follow-ups the C1/C2/C4 review opened
**Owner: Build · S each**

- `IndicatorMenu.tsx:101` still uses hard `disabled` on locked rows, the same
  focus trap C2 removed from the rail. It has an "unlock all →" link at the
  bottom, so the upsell is not unreachable — but the individual rows still
  cannot be focused or explained. `TimeframePicker.tsx:142,178` already uses the
  `aria-disabled` pattern, so the repo is two-thirds converted.
- `src/app/api/billing/revoke/` and `RevokeButton.tsx` (untracked, from the
  earlier phase-0 work) have had no security review. Revoking an entitlement is
  a privileged action; that route needs one before it ships.
- The pane render bodies (`ChartPro.tsx:802-803, 1659-1660, 2127`) run several
  un-memoised O(visible-bars) passes on every render and the panes are not
  `memo`'d. Pre-existing, but it is the multiplier that makes any extra
  `ChartPro` render cost real.

---

### Not proposed, deliberately
Pine-Script-style expressions, tick/second bars (needs a licensed feed — roadmap P2),
and a second charting library. The chart already has 15+ indicators, 12 drawing tools,
15 timeframes, multi-chart, layouts, sync, export and a table alternative; the gap is
not more chart surface, it is the VN-specific data and the honesty of the gates.
