# Draft — rewrite before filing

Next.js requires that issue descriptions be written by a human ("issue
descriptions from external contributors must be written and created by a
human"), while explicitly allowing AI help with the reproduction. So this is a
fact sheet in issue shape, not something to paste. Put it in your own words —
the reproduction is the part that carries the weight anyway.

File at: https://github.com/vercel/next.js/issues/new/choose → Bug Report

---

## Link to the code that reproduces this issue

https://github.com/thoaihuynh2509/vn-terminal/tree/main/docs/repro/cache-components-hydration

## To Reproduce

1. The repro has no dependencies of its own — put a `node_modules` beside it, or
   copy one from a Next 16.3.4 project. It must not sit inside another Next
   project, or Next picks up the parent's root files.
2. `npx next build && npx next start -p 3212`
3. Open `/e`. Wait for the page to settle.
4. Click the button labelled `shell` — the counter increments.
5. Click the button labelled `suspended` — nothing happens.

Same result in `next dev`.

## Current vs. Expected behavior

**Current.** With `cacheComponents: true`, a Suspense boundary that actually
streams never hydrates. The fallback stays in the DOM, the streamed content is
inserted alongside it, and client components inside the boundary are inert —
handlers never attach and state never updates. Nothing is logged: no hydration
error, no warning.

After `/e` has fully loaded, `<main>` contains:

```html
<div id="control"><button data-counter="shell">shell: 1</button></div>
<!--$~--><template id="B:0"></template><p id="fallback">loading…</p><!--/$
```

The boundary comment is `$~`, its `<template id="B:0">` is still present, and
the fallback is still rendered — while the streamed `#streamed` node is also in
the document.

**Expected.** The fallback is replaced by the streamed content and that content
hydrates, as it does with `cacheComponents: false`.

**Control — identical code, one flag:**

```
cacheComponents: false  ->  fallback removed,      counter increments
cacheComponents: true   ->  fallback still in DOM, counter stuck at 0
```

**What narrows it.** Five routes in the repro:

| route | what the suspended child does      | fallback shown | hydrates |
|-------|------------------------------------|----------------|----------|
| `/b`  | nothing — client component directly under Suspense | no | yes |
| `/c`  | `await Promise.resolve()`          | no             | yes      |
| `/d`  | `await connection()`               | yes            | **no**   |
| `/e`  | `await new Promise(r => setTimeout(r, 50))` | yes    | **no**   |
| `/`   | `connection()` + a 50ms await      | yes            | **no**   |

So it is not `connection()` (`/e` reproduces with only a timer), not Suspense
(`/b` is fine), and not async server components (`/c` awaits and is fine,
because a microtask settles before React needs the fallback and the boundary
never actually streams). The trigger is the boundary streaming at all.

**Not the duplicate-marker issue.** The served HTML contains exactly one
`id="S:0"`, one `id="B:0"` and one `$RC("B:0")` completion call, so this looks
distinct from #96551 and #97310 — the replacement script is emitted correctly
and the boundary still does not complete on the client.

## Provide environment information

```
Operating System:
  Platform: darwin
  Arch: arm64
  Version: Darwin Kernel Version 23.5.0
  Available memory (MB): 16384
  Available CPU cores: 8
Binaries:
  Node: 24.4.0
  npm: 11.12.1
  pnpm: 10.17.1
Relevant Packages:
  next: 16.3.4
  react: 19.2.8
  react-dom: 19.2.8
  typescript: 5.9.3
Next.js Config:
  output: N/A
```

## Which area(s) are affected?

Select whichever options correspond to Cache Components / `use cache` and
Partial Prerendering. (Check the current list on the form rather than trusting
this line.)

## Which stage(s) are affected?

`next build` (local) and `next start`, and `next dev`.

## Additional context

Found while enabling `cacheComponents` on a real app. Worth saying because it
affects how easy this is to miss: the migration looked completely successful —
typecheck, lint and 779 unit tests passed, the build was green, and prerendered
routes went from 5 to 53. Every interactive element inside a streamed boundary
was dead, and the only signal was clicking the page.

The shape that triggers it is the one the Cache Components documentation
recommends for request-time data — read the session or a live feed inside a
component behind `<Suspense>` and let it stream — so in a real app it affects
every page that follows that guidance at once.
