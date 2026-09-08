# Repro: streamed Suspense content never hydrates under `cacheComponents`

Next 16.3.4. ~40 lines, no application code.

## The bug

With `cacheComponents: true`, a Suspense boundary that **actually streams** —
one whose fallback is genuinely rendered because its child suspends — leaves the
fallback in the DOM and never hydrates the streamed subtree. Client components
inside it render but are inert: handlers never attach, state never updates.

There is no hydration error or warning in the console.

## Running it

This has no dependencies of its own; run it beside a checkout of the app so
`node_modules` resolves, or copy one in. It must NOT be nested inside another
Next project — Next will pick up the parent's root files.

```sh
npx next build && npx next start -p 3212
```

Then open each route and click both buttons. The one labelled `shell` is the
control: an identical client component in the static shell.

## What each route isolates

| route | what the suspended child does | fallback shown | hydrates |
|-------|-------------------------------|----------------|----------|
| `/`   | `connection()` + a 50ms await | yes            | **no**   |
| `/b`  | nothing — client component directly under Suspense | no | yes |
| `/c`  | `await Promise.resolve()` (microtask, never suspends) | no | yes |
| `/d`  | `connection()` only          | yes            | **no**   |
| `/e`  | `await setTimeout(50)` only  | yes            | **no**   |

So it is not `connection()`, and not Suspense, and not the async server
component. `/c` awaits and still works — because a microtask resolves before
React needs the fallback, so the boundary never actually streams. The trigger is
the boundary **streaming**.

## The control that proves it is the flag

Set `cacheComponents: false`, rebuild, and open `/e` again. Same code:

```
cacheComponents: true   →  fallback still in DOM, "suspended: 0"  (dead)
cacheComponents: false  →  fallback removed,      "suspended: 1"  (works)
```

## Why it matters

This is the standard shape the Cache Components docs recommend: a component that
reads request data sits behind `<Suspense>` and streams. Any interactive client
component inside that boundary — a sortable table, a button, a form — renders and
then does nothing.

Found while migrating vn-market-terminal: the build was green, types and lint
passed, 779 unit tests passed, and 53 routes prerendered. The only signal was
clicking the page.
