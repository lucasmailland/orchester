// packages/mnemosyne/src/recall/cache.ts
//
// A7 — Hierarchical caching. L1 = workspace LRU 60s TTL keyed on
// (workspaceId, query_hash, scope, scopeRef, topK).
// L2 (embedding LRU) lives in src/recall/embed.ts.
// L3 (mnemo_query_cache table) added in Task 4.3.
import { LRUCache } from "lru-cache";

const RECALL_CACHE_MAX = 5_000;
const RECALL_CACHE_TTL_MS = 60_000;

export interface RecallCacheKeyParts {
  workspaceId: string;
  queryHash: string;
  scope: string | null;
  scopeRef: string | null;
  topK: number;
  agentId?: string | null;
}

export function recallCacheKey(parts: RecallCacheKeyParts): string {
  return [
    parts.workspaceId,
    parts.agentId ?? "*",
    parts.scope ?? "*",
    parts.scopeRef ?? "*",
    parts.topK,
    parts.queryHash,
  ].join("|");
}

// lru-cache v11's `LRUCache<K, V>` requires `V extends {}`, so we
// constrain the value type to "any non-nullish value" (essentially any
// JS object / array — what recall results always are).
// eslint-disable-next-line @typescript-eslint/ban-types
export const recallCache = new LRUCache<string, {}>({
  max: RECALL_CACHE_MAX,
  ttl: RECALL_CACHE_TTL_MS,
});

export function invalidateRecallCacheForWorkspace(workspaceId: string): void {
  for (const k of recallCache.keys()) {
    if (k.startsWith(`${workspaceId}|`)) recallCache.delete(k);
  }
}
