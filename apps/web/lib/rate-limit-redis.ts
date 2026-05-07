import "server-only";
import type { RateLimitAdapter, RateLimitOptions, RateLimitResult } from "./rate-limit";

/**
 * Redis adapter para rate-limit. Activarlo en `apps/web/instrumentation.ts`:
 *
 *   import { setRateLimitAdapter } from "@/lib/rate-limit";
 *   import { createRedisAdapter } from "@/lib/rate-limit-redis";
 *
 *   export async function register() {
 *     if (process.env.REDIS_URL) {
 *       const { createClient } = await import("redis");
 *       const client = createClient({ url: process.env.REDIS_URL });
 *       await client.connect();
 *       setRateLimitAdapter(createRedisAdapter(client));
 *     }
 *   }
 *
 * Implementa el algoritmo "atomic increment + TTL" — una sola roundtrip,
 * sin race conditions entre réplicas. Usa el patrón Lua-script de Upstash.
 */

interface RedisLikeClient {
  /** Atomic Lua script execution. node-redis lo expone como `eval`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

const LUA_TOKEN_BUCKET = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_sec = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local raw = redis.call('HMGET', key, 'tokens', 'updated_at')
local tokens = tonumber(raw[1])
local updated_at = tonumber(raw[2])

if tokens == nil then
  tokens = capacity
  updated_at = now
end

local delta_sec = (now - updated_at) / 1000
tokens = math.min(capacity, tokens + delta_sec * refill_per_sec)

if tokens < 1 then
  redis.call('HMSET', key, 'tokens', tokens, 'updated_at', now)
  redis.call('PEXPIRE', key, 600000)
  local needed = 1 - tokens
  local retry_after_ms = math.ceil((needed / refill_per_sec) * 1000)
  return { 0, math.floor(tokens), retry_after_ms }
end

tokens = tokens - 1
redis.call('HMSET', key, 'tokens', tokens, 'updated_at', now)
redis.call('PEXPIRE', key, 600000)
return { 1, math.floor(tokens), 0 }
`;

/**
 * Ejecuta un script Lua en Redis. node-redis usa el método `eval` (Redis
 * server-side scripting, no relacionado con `eval()` de JavaScript).
 */
async function runLua(
  client: RedisLikeClient,
  script: string,
  keys: string[],
  args: string[]
): Promise<unknown> {
  const method = client["eval"];
  return method.call(client, script, { keys, arguments: args });
}

export function createRedisAdapter(client: RedisLikeClient): RateLimitAdapter {
  return {
    async consume(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
      const namespacedKey = `orchester:rl:${key}`;
      const result = (await runLua(
        client,
        LUA_TOKEN_BUCKET,
        [namespacedKey],
        [String(opts.capacity), String(opts.refillPerSec), String(Date.now())]
      )) as [number, number, number];

      const [allowed, remaining, retryAfterMs] = result;
      if (allowed === 1) {
        return { ok: true, remaining };
      }
      return { ok: false, remaining: 0, retryAfterMs };
    },
  };
}
