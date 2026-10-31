/**
 * Minimal in-memory rate limiter.
 *
 * Serverless functions are ephemeral, so this is best-effort rather than a
 * strict global guarantee (each warm instance keeps its own counters). It's
 * enough to blunt accidental hammering (double-clicks, retry loops, brute
 * forcing login) for a 2-user app without needing a Redis deployment.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Periodically forget old buckets so this doesn't grow unbounded on a
// long-lived warm instance.
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupIfNeeded() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}

/**
 * Returns true if the request identified by `key` is allowed, false if it
 * should be rejected with 429. `limit` requests are allowed per
 * `windowMs` window.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): boolean {
  cleanupIfNeeded();

  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) {
    return false;
  }

  bucket.count += 1;
  return true;
}

/** Best-effort client identifier for rate limiting unauthenticated requests. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}
