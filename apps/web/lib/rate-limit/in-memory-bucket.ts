// apps/web/lib/rate-limit/in-memory-bucket.ts
//
// Lightweight per-process sliding-window rate limiter for debug-class
// endpoints. NOT for production traffic — per-process state means a
// multi-pod deployment multiplies the cap by the pod count, and
// process restarts reset history. The cap is intentionally low
// enough that this is fine for its current users (Inspector UI v2).
//
// Replace with `pg-token-bucket.ts` (TODO, separate PR) when a route
// needs strict, cluster-wide enforcement.

/**
 * Build a sliding-window rate limiter that admits at most `maxCalls`
 * per `windowMs` per key.
 *
 * Returns:
 *   - `tryAcquire(key)`: returns { allowed, retryAfterMs } and records
 *     the call when allowed.
 *   - `reset()`: drops all state (test helper).
 *
 * Note: there's no GC for stale keys — the call rate is low enough
 * that the memory footprint is bounded by active-user count over the
 * window. For unbounded keyspaces, swap for a per-process LRU.
 */
export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until the next call would be admitted (0 when allowed). */
  retryAfterMs: number;
}

export interface RateLimitOptions {
  windowMs: number;
  maxCalls: number;
  /**
   * Clock injection point for tests. Defaults to `Date.now`. The
   * production path uses the real clock; tests override to verify
   * boundary conditions deterministically.
   */
  now?: () => number;
}

export interface InMemoryRateLimiter {
  tryAcquire(key: string): RateLimitDecision;
  reset(): void;
}

export function makeInMemoryRateLimiter(opts: RateLimitOptions): InMemoryRateLimiter {
  const windowMs = opts.windowMs;
  const maxCalls = opts.maxCalls;
  const now = opts.now ?? Date.now;
  const state = new Map<string, number[]>();

  return {
    tryAcquire(key: string): RateLimitDecision {
      const t = now();
      const cutoff = t - windowMs;
      // Compact in place: keep only timestamps inside the window.
      const history = (state.get(key) ?? []).filter((ts) => ts > cutoff);
      if (history.length >= maxCalls) {
        const oldest = history[0]!;
        return { allowed: false, retryAfterMs: Math.max(0, oldest + windowMs - t) };
      }
      history.push(t);
      state.set(key, history);
      return { allowed: true, retryAfterMs: 0 };
    },
    reset(): void {
      state.clear();
    },
  };
}
