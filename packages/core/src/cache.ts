/**
 * Process-local TTL cache with single-flight and stale-on-error.
 *
 * Every upstream feed here is an unofficial public endpoint with no SLA and no
 * published rate limit, so three properties matter more than raw speed:
 *   1. we never issue concurrent identical requests (single-flight),
 *   2. a brief upstream outage serves stale data rather than an error page,
 *   3. one slow feed cannot hang a page render (timeout).
 */
type Entry<T> = { value: T; expires: number; stored: number };

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/** How long stale data may still be served after a fetch failure. */
const STALE_GRACE_MS = 10 * 60 * 1000;

export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > now) return hit.value;

  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;

  const p = (async () => {
    try {
      const value = await fetcher();
      store.set(key, { value, expires: Date.now() + ttlMs, stored: Date.now() });
      return value;
    } catch (err) {
      // Serve stale rather than fail, but only within the grace window —
      // silently returning hours-old prices would be worse than an error.
      if (hit && Date.now() - hit.stored < STALE_GRACE_MS) return hit.value;
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

export async function fetchJson<T>(
  url: string,
  { timeoutMs = 8000, feed = "upstream" }: { timeoutMs?: number; feed?: string } = {},
): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      cache: "no-store",
      headers: {
        // These endpoints reject requests without a browser-shaped UA.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
      },
    });
    if (res.status === 429) throw new Error("rate limited (HTTP 429)");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${feed}: ${msg === "This operation was aborted" ? `timeout after ${timeoutMs}ms` : msg}`);
  } finally {
    clearTimeout(timer);
  }
}
