// apps/web/lib/brain/embed.ts
//
// Embedding wrapper for Brain Core. Workspace-keyed in-process LRU
// cache so that re-extracting the same statement (e.g. via dedup) does
// not re-hit the embedding API. Cache key includes workspace_id per
// threat model T-9 / B-T4 (no cross-tenant cache leak).
//
// Defers to `lib/embeddings.ts` for the actual provider call — Brain
// Core does not introduce a second embedding backend.
import "server-only";
import { createHash } from "crypto";
import { LRUCache } from "lru-cache";
import { embed as embedRaw } from "@/lib/embeddings";
import type { EmbeddingProvider } from "@/lib/embeddings";
import type { DbClient } from "@orchester/db";

const CACHE_MAX = 10_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — facts are immutable, embedding rarely needs refresh

const cache = new LRUCache<string, number[]>({ max: CACHE_MAX, ttl: CACHE_TTL_MS });

function cacheKey(workspaceId: string, model: string, text: string): string {
  const h = createHash("sha256").update(text).digest("hex");
  return `${workspaceId}|${model}|${h}`;
}

export interface EmbedBrainInput {
  workspaceId: string;
  texts: string[];
  /**
   * Embedding provider. REQUIRED per Mnemosyne Charter §25 (no
   * hardcoded provider defaults). Audit FIX-002. If undefined the
   * function returns `[]` rather than silently picking OpenAI —
   * callers in Mode A (no embedding provider configured) get an
   * empty result and downstream code (createFact / searchBrain) is
   * expected to degrade gracefully (FIX-005, FIX-007).
   */
  provider?: EmbeddingProvider;
  /**
   * Embedding model identifier. REQUIRED per Charter §25 (no
   * hardcoded model defaults). Audit FIX-003. If undefined alongside
   * `provider`, the function returns `[]` (Mode A signal).
   */
  model?: string;
  tx?: DbClient;
}

/**
 * Embed an array of texts, returning one vector per input. Cache hits
 * are returned synchronously; cache misses batch through the embedding
 * provider in one HTTP call.
 *
 * Charter §25 (audit FIX-002, FIX-003, FIX-005): if `provider` or
 * `model` is unset, this returns `[]` immediately. The caller is
 * responsible for resolving these from the workspace configuration
 * (future `mnemo.embedding_provider` + `mnemo.embedding_model`
 * settings); when the workspace has none configured we are in Mode A
 * and embedding is gracefully unavailable.
 */
export async function embedBrain(input: EmbedBrainInput): Promise<number[][]> {
  // FIX-002 + FIX-003 + FIX-005 (audit, Charter §25, M-A-001): no
  // hardcoded provider/model fallback. When either side is undefined
  // we are in Mode A — short-circuit to an empty result instead of
  // silently picking OpenAI (which would throw inside `embedRaw` if
  // the workspace has no OpenAI key configured). Downstream consumers
  // (createFact / searchBrain / updateFact) handle `[]` per FIX-006,
  // FIX-007, FIX-008.
  if (!input.provider || !input.model) return [];
  const provider = input.provider;
  const model = input.model;
  const out: number[][] = new Array(input.texts.length);
  const misses: { idx: number; text: string }[] = [];

  for (let i = 0; i < input.texts.length; i++) {
    const text = input.texts[i]!;
    const k = cacheKey(input.workspaceId, model, text);
    const hit = cache.get(k);
    if (hit) {
      out[i] = hit;
    } else {
      misses.push({ idx: i, text });
    }
  }

  if (misses.length === 0) return out;

  const fresh = await embedRaw(
    input.workspaceId,
    provider,
    model,
    misses.map((m) => m.text),
    input.tx
  );

  for (let i = 0; i < misses.length; i++) {
    const m = misses[i]!;
    const v = fresh.vectors[i]!;
    out[m.idx] = v;
    cache.set(cacheKey(input.workspaceId, model, m.text), v);
  }

  return out;
}

/** Drop one (workspaceId, model?, text?) from the cache. Useful in tests. */
export function invalidateEmbedding(workspaceId: string): void {
  // Best-effort: iterate keys and drop entries whose key starts with the prefix.
  for (const k of cache.keys()) {
    if (k.startsWith(`${workspaceId}|`)) cache.delete(k);
  }
}
