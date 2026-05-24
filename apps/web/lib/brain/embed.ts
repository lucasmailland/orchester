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
  provider?: EmbeddingProvider;
  model?: string;
  tx?: DbClient;
}

/**
 * Embed an array of texts, returning one vector per input. Cache hits
 * are returned synchronously; cache misses batch through the embedding
 * provider in one HTTP call.
 *
 * Provider/model default to whatever the workspace's primary KB uses
 * (looked up by caller); for v1 we accept the args from the caller and
 * don't introspect the workspace default. See OQ-B4.
 */
export async function embedBrain(input: EmbedBrainInput): Promise<number[][]> {
  const provider = input.provider ?? "openai";
  const model = input.model ?? "text-embedding-3-small";
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
