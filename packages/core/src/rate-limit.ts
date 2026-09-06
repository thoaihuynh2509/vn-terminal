/**
 * Fixed-ceiling sliding-window limiter.
 *
 * Per-process and in memory: every serverless instance keeps its own counters
 * and a deploy resets them. It bounds probing of one instance; it is not a
 * shared quota and must not be relied on as one.
 */
/**
 * The address a limiter counts against.
 *
 * X-Forwarded-For is a list the caller can seed: only the entries a proxy
 * appended are ours, and the rightmost is the peer the closest proxy actually
 * saw. Reading the leftmost entry lets a caller mint a fresh bucket per request
 * and the ceiling never fires.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export interface LimiterOptions {
  windowMs: number;
  max: number;
  /** Ceiling on tracked keys; the map is cleared wholesale when it is passed. */
  maxKeys?: number;
}

export function createLimiter({ windowMs, max, maxKeys = 5000 }: LimiterOptions): (key: string) => boolean {
  const hits = new Map<string, number[]>();
  return function limited(key: string): boolean {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > maxKeys) hits.clear();
    return recent.length > max;
  };
}
