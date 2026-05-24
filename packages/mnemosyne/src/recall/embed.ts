// packages/mnemosyne/src/recall/embed.ts
//
// Workspace-keyed LRU cache for embeddings. The actual provider call is
// injected by the caller — Mnemosyne does NOT bundle its own embedding
// backend. The host app passes its `embed(...)` implementation in.
//
// Per Mnemosyne Charter §25 (and audit findings F-002/F-003), `provider`
// and `model` are REQUIRED inputs. The caller resolves them from the
// workspace's mnemo configuration; this module never picks defaults.
//
// §0.1: this file is package-clean — no `server-only`, no path aliases
// to the host app. Server-side enforcement is the host's responsibility
// (mnemosyne is consumed only from server contexts in apps/web).
import { createHash } from "crypto";
import { LRUCache } from "lru-cache";
import type { DbClient } from "@orchester/db";

export type EmbeddingProvider = "openai" | "google" | "voyage";

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  tokensUsed: number;
}

/**
 * The host-provided embedding function. Signature mirrors
 * `apps/web/lib/embeddings.ts::embed` so adapter glue is trivial:
 * `embedFn: embed` (from `@/lib/embeddings`).
 */
export type EmbedFn = (
  workspaceId: string,
  provider: EmbeddingProvider,
  model: string,
  texts: string[],
  tx?: DbClient
) => Promise<EmbeddingResult>;

const CACHE_MAX = 10_000;
const CACHE_TTL_MS = 60 * 60 * 1000;

const cache = new LRUCache<string, number[]>({
  max: CACHE_MAX,
  ttl: CACHE_TTL_MS,
});

function cacheKey(workspaceId: string, model: string, text: string): string {
  const h = createHash("sha256").update(text).digest("hex");
  return `${workspaceId}|${model}|${h}`;
}

export interface EmbedMnemoInput {
  workspaceId: string;
  texts: string[];
  provider: EmbeddingProvider;
  model: string;
  /** Host-provided embedding implementation. Required: §25 forbids
   *  mnemosyne from picking a default backend. */
  embedFn: EmbedFn;
  tx?: DbClient;
}

export async function embedMnemo(input: EmbedMnemoInput): Promise<number[][]> {
  const out: number[][] = new Array(input.texts.length);
  const misses: { idx: number; text: string }[] = [];
  for (let i = 0; i < input.texts.length; i++) {
    const text = input.texts[i]!;
    const k = cacheKey(input.workspaceId, input.model, text);
    const hit = cache.get(k);
    if (hit) out[i] = hit;
    else misses.push({ idx: i, text });
  }
  if (misses.length === 0) return out;
  const fresh = await input.embedFn(
    input.workspaceId,
    input.provider,
    input.model,
    misses.map((m) => m.text),
    input.tx
  );
  for (let i = 0; i < misses.length; i++) {
    const m = misses[i]!;
    const v = fresh.vectors[i]!;
    out[m.idx] = v;
    cache.set(cacheKey(input.workspaceId, input.model, m.text), v);
  }
  return out;
}

export function invalidateEmbedding(workspaceId: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(`${workspaceId}|`)) cache.delete(k);
  }
}
