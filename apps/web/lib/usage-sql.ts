import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { schema } from "@orchester/db";

/**
 * Reading token counts out of `usage_event` in SQL.
 *
 * Every model call leaves one `usage_event` row with its real price in
 * `cost_usd`; the token counts live in `metadata`, in two shapes:
 * - `recordAiUsage` (lib/ai/run.ts) writes the split: `tokensIn`,
 *   `tokensOut`, `cacheWriteTokens`, `cacheReadTokens` and `tokensTotal`;
 * - the channel router writes only `tokens`, a total.
 * Older rows may carry `tokens` or `tokensOut` alone. A value that is not a
 * JSON number counts as missing, never as an error.
 */

/** A number at `metadata -> key`, or null. `key` is a constant of the callers. */
export function usageMetaNumber(key: string): SQL {
  if (!/^[A-Za-z]+$/.test(key)) throw new Error(`bad metadata key: ${key}`);
  const m = schema.usageEvents.metadata;
  return sql`(CASE WHEN jsonb_typeof(${m} -> '${sql.raw(key)}') = 'number' THEN (${m} ->> '${sql.raw(key)}')::numeric END)`;
}

/**
 * Tokens of one row: `tokensTotal`, else the router's `tokens`, else
 * `tokensIn + tokensOut` when either is there; null when the row has none.
 */
export function usageRowTokens(): SQL {
  return sql`COALESCE(${usageMetaNumber("tokensTotal")}, ${usageMetaNumber("tokens")},
    CASE WHEN ${usageMetaNumber("tokensIn")} IS NOT NULL OR ${usageMetaNumber("tokensOut")} IS NOT NULL
      THEN COALESCE(${usageMetaNumber("tokensIn")}, 0) + COALESCE(${usageMetaNumber("tokensOut")}, 0) END)`;
}

/** Aggregates over a set of `usage_event` rows, for a `select`. */
export function usageSums() {
  const sum = (expr: SQL) => sql<number>`COALESCE(SUM(${expr}), 0)::float8`;
  return {
    events: sql<number>`count(*)::int`,
    costUsd: sql<number>`COALESCE(SUM(${schema.usageEvents.costUsd}), 0)::float8`,
    tokensIn: sum(usageMetaNumber("tokensIn")),
    tokensOut: sum(usageMetaNumber("tokensOut")),
    cacheWrite: sum(usageMetaNumber("cacheWriteTokens")),
    cacheRead: sum(usageMetaNumber("cacheReadTokens")),
    tokensTotal: sum(usageRowTokens()),
  };
}
