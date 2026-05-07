import "server-only";

/**
 * Rate-limit con interfaz pluggable. Default: in-memory token bucket.
 * Para multi-node, swap a Redis con `setRateLimitAdapter(redisAdapter)`.
 *
 * Cómo usar Redis (cuando llegue ese momento):
 *
 *   import { setRateLimitAdapter, createRedisAdapter } from "@/lib/rate-limit";
 *   setRateLimitAdapter(createRedisAdapter(process.env.REDIS_URL!));
 *
 * El adapter Redis está en `lib/rate-limit-redis.ts` (lazy: sólo se carga si
 * lo activás).
 *
 * En dev, los buckets viven en globalThis para sobrevivir HMR.
 */

export interface RateLimitOptions {
  /** Maximum tokens (e.g. 100 = 100 requests). */
  capacity: number;
  /** Tokens added per second (e.g. 100/60 = 100 req/min). */
  refillPerSec: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Si !ok, ms hasta que haya tokens. Si ok, undefined. */
  retryAfterMs?: number;
  /** Tokens restantes después del consume (para X-RateLimit-Remaining). */
  remaining: number;
}

export interface RateLimitAdapter {
  consume(key: string, opts: RateLimitOptions): Promise<RateLimitResult>;
}

// ─── In-memory adapter (default) ────────────────────────────────

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const globalForLimiter = globalThis as unknown as {
  __orchesterRateBuckets?: Map<string, Bucket>;
};
if (!globalForLimiter.__orchesterRateBuckets) {
  globalForLimiter.__orchesterRateBuckets = new Map();
}
const BUCKETS = globalForLimiter.__orchesterRateBuckets;

const memoryAdapter: RateLimitAdapter = {
  async consume(key, opts) {
    const now = Date.now();
    let b = BUCKETS.get(key);
    if (!b) {
      b = { tokens: opts.capacity, updatedAt: now };
      BUCKETS.set(key, b);
    }
    const delta = (now - b.updatedAt) / 1000;
    b.tokens = Math.min(opts.capacity, b.tokens + delta * opts.refillPerSec);
    b.updatedAt = now;
    if (b.tokens < 1) {
      const needed = 1 - b.tokens;
      const retryAfterMs = Math.ceil((needed / opts.refillPerSec) * 1000);
      return { ok: false, retryAfterMs, remaining: 0 };
    }
    b.tokens -= 1;
    return { ok: true, remaining: Math.floor(b.tokens) };
  },
};

let activeAdapter: RateLimitAdapter = memoryAdapter;

/**
 * Permite swappear el adapter (e.g. Redis para multi-node). Idempotente; el
 * último que se setea gana.
 */
export function setRateLimitAdapter(adapter: RateLimitAdapter): void {
  activeAdapter = adapter;
}

/**
 * Returns rate-limit result. Async para que adapters Redis funcionen.
 */
export async function rateLimit(
  key: string,
  opts: RateLimitOptions
): Promise<RateLimitResult> {
  return activeAdapter.consume(key, opts);
}

/**
 * Periodic cleanup to prevent unbounded growth (every 5min, drop buckets idle > 10min).
 * Single setInterval is fine — runs in the same process.
 */
const globalForCleanup = globalThis as unknown as { __orchesterRateCleanupRunning?: boolean };
if (!globalForCleanup.__orchesterRateCleanupRunning) {
  globalForCleanup.__orchesterRateCleanupRunning = true;
  setInterval(() => {
    const cutoff = Date.now() - 600_000;
    for (const [k, v] of BUCKETS.entries()) {
      if (v.updatedAt < cutoff) BUCKETS.delete(k);
    }
  }, 300_000).unref?.();
}

/**
 * Helper para rutas que ya hicieron `getCurrentSession()` / `getCurrentWorkspace()`.
 * Devuelve `Response` listo (`429 Too Many Requests`) si el limit está saturado, o
 * `null` si la request puede continuar.
 *
 * Uso:
 *   const limited = enforceRateLimit(`test-chat:${ws.id}:${session.user.id}`,
 *                                    { capacity: 30, refillPerSec: 30 / 60 });
 *   if (limited) return limited;
 *
 * Presets sugeridos:
 *   - LLM-bound (test-chat, conversation reply): 30 req/min (cara, drena cuota Anthropic)
 *   - Cheap reads (list, get): 600 req/min (no rate-limit prácticamente)
 *   - Mutations (POST/PATCH/DELETE): 120 req/min
 *   - Public webhooks (telegram, slack): 600 req/min por canal
 */
export async function enforceRateLimit(
  key: string,
  opts: RateLimitOptions
): Promise<Response | null> {
  const r = await rateLimit(key, opts);
  if (r.ok) return null;
  const retryAfterMs = r.retryAfterMs ?? 1000;
  return new Response(
    JSON.stringify({ error: "Too many requests", retryAfterMs }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(Math.ceil(retryAfterMs / 1000)),
        "x-ratelimit-remaining": String(r.remaining),
      },
    }
  );
}

/** Presets reutilizables para no inventar números en cada handler. */
export const RATE_LIMITS = {
  /** Endpoints que tocan LLM (queman créditos del provider). */
  LLM_HEAVY: { capacity: 30, refillPerSec: 30 / 60 },
  /** Mutaciones generales (PATCH/POST/DELETE de records). */
  MUTATION: { capacity: 120, refillPerSec: 120 / 60 },
  /** Webhooks entrantes públicos. */
  WEBHOOK: { capacity: 600, refillPerSec: 600 / 60 },
} as const;
