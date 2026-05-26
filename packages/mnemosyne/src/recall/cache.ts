// packages/mnemosyne/src/recall/cache.ts
//
// A7 — Hierarchical caching.
//
//   L1: in-process workspace LRU, 60s TTL, keyed on
//       (workspaceId, query_hash, scope, scopeRef, topK, agentId).
//       Below — `recallCache`.
//
//   L2: embedding LRU lives in src/recall/embed.ts.
//
//   L3: `mnemo_query_cache` table — cross-pod, semantic similarity
//       lookup. v1.6 G1-4 wires this. We persist the QUERY embedding
//       and the RESULT memory ids; a new query whose embedding has
//       cosine >= 0.95 with a row created in the last 5 minutes
//       short-circuits the full hybrid pipeline.
//
//   The L3 wiring is OPT-IN: `searchMnemo` calls `getL3Cache` only
//   when an embedding provider is configured (Mode B/C). Mode A
//   (FTS-only) skips L3 entirely — there's no query vector to hash.
import { LRUCache } from "lru-cache";
import { sql } from "drizzle-orm";
import type { Tx } from "../tx";
import type { MnemoFact } from "../primitives/fact";

// v1.6 G1-4: structural types copied from `./search.ts` so this module
// can be imported by `search.ts` itself without creating a cycle. The
// canonical exports live in search.ts; if we ever extract a
// `search-types.ts` we can re-import from there.
export interface RecallReasons {
  semantic: number;
  recency: number;
  frequency: number;
  relevance: number;
  pin: number;
}
export interface RecallHit {
  fact: MnemoFact;
  score: number;
  reasons: RecallReasons;
  expandedFromId?: string | null;
}

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

// ───── v1.6 G1-4: L3 — `mnemo_query_cache` table wiring ────────────

/**
 * Cosine similarity threshold for the L3 lookup. Tight (0.95) so we
 * don't return stale recall for "different enough" queries — the L1
 * LRU already catches near-identical repeats, L3 is for paraphrases.
 */
const L3_COSINE_THRESHOLD = 0.95;
/** Time window (minutes) during which an L3 row is considered fresh. */
const L3_TTL_MINUTES = 5;
/** Per-workspace cap before LRU-style eviction kicks in. */
const L3_MAX_PER_WORKSPACE = 1000;

/**
 * Convert a JS number[] to the `vector(1536)` literal expected by
 * pgvector. Same format used elsewhere in this module.
 */
function toVecLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

export interface L3CacheHit {
  hits: RecallHit[];
  ageSeconds: number;
}

/**
 * v1.6 G1-4: look up the L3 cache for a semantically-similar recent
 * query. Returns the cached `RecallHit[]` when there's a row within
 * `L3_TTL_MINUTES` whose query embedding has cosine >= 0.95 with the
 * incoming query embedding. Otherwise returns `null`.
 *
 * Defensive: every error path returns `null` so a cache miss / table
 * issue never breaks recall.
 *
 * Schema:
 *   query_embedding         vector(1536) NOT NULL
 *   result_memory_ids       text[] NOT NULL
 *   result_memory_kinds     text[] NOT NULL   (parallel array)
 *   scope, scope_ref, agent_id, top_k, hit_count, last_used_at, created_at
 *
 * On hit we also bump `hit_count` and `last_used_at` so the per-
 * workspace LRU eviction (see `setL3Cache`) keeps hot rows alive.
 */
export async function getL3Cache(
  workspaceId: string,
  queryEmbedding: number[],
  tx: Tx,
  opts: { scope?: string | null; scopeRef?: string | null; agentId?: string | null; topK: number }
): Promise<L3CacheHit | null> {
  if (!queryEmbedding || queryEmbedding.length === 0) return null;
  try {
    const vecLit = toVecLiteral(queryEmbedding);
    // We compute `(1 - cosine_distance)` so the threshold reads as
    // "cosine similarity >= 0.95" — the natural way users talk about
    // similarity, even though pgvector's <=> is a distance metric.
    const rows = (await tx.execute(sql`
      SELECT
        id,
        result_memory_ids,
        EXTRACT(EPOCH FROM (now() - created_at))::float AS age_seconds,
        (1.0 - (query_embedding <=> ${vecLit}::vector(1536))) AS similarity
      FROM mnemo_query_cache
      WHERE workspace_id = ${workspaceId}
        AND created_at > now() - (${L3_TTL_MINUTES} || ' minutes')::interval
        AND top_k = ${opts.topK}
        AND COALESCE(scope, '') = COALESCE(${opts.scope ?? null}, '')
        AND COALESCE(scope_ref, '') = COALESCE(${opts.scopeRef ?? null}, '')
        AND COALESCE(agent_id, '') = COALESCE(${opts.agentId ?? null}, '')
      ORDER BY query_embedding <=> ${vecLit}::vector(1536) ASC
      LIMIT 1
    `)) as unknown as Array<{
      id: string;
      result_memory_ids: string[];
      age_seconds: number;
      similarity: number;
    }>;

    const row = rows[0];
    if (!row || row.similarity < L3_COSINE_THRESHOLD) return null;

    // Re-hydrate the cached memory ids against `mnemo_fact`. Doing this
    // here (rather than storing the full row JSON) keeps the cache
    // honest — pinned/forgotten changes between the cache write and
    // the new read are reflected immediately.
    const ids = row.result_memory_ids;
    if (!ids || ids.length === 0) {
      // Empty result set is a valid cached value — return zero hits.
      return { hits: [], ageSeconds: row.age_seconds };
    }
    const factRows = (await tx.execute(sql`
      SELECT
        id, workspace_id, agent_id, scope, scope_ref, kind, subject,
        statement, confidence, pinned, relevance, hit_count,
        last_recalled_at, source_message_ids, attributed_to,
        linked_memory_ids, metadata, status, merged_into_id,
        valid_from, valid_to, created_at, updated_at, memory_type, attribution
      FROM mnemo_fact
      WHERE workspace_id = ${workspaceId}
        AND status = 'active'
        AND (valid_to IS NULL OR valid_to > now())
        AND id = ANY(${sql.param(ids)}::text[])
    `)) as unknown as Array<{
      id: string;
      workspace_id: string;
      agent_id: string | null;
      scope: string;
      scope_ref: string | null;
      kind: string;
      subject: string;
      statement: string;
      confidence: number;
      pinned: boolean;
      relevance: number;
      hit_count: number;
      last_recalled_at: Date | null;
      source_message_ids: string[];
      attributed_to: "user" | "assistant" | "system" | null;
      linked_memory_ids: string[];
      metadata: Record<string, unknown>;
      status: string;
      merged_into_id: string | null;
      valid_from: Date;
      valid_to: Date | null;
      created_at: Date;
      updated_at: Date;
      memory_type: string | null;
      attribution: string | null;
    }>;

    // Preserve the ORIGINAL order from `result_memory_ids` so the
    // cached top-K ranking survives the SET-returning hydration.
    const byId = new Map(factRows.map((r) => [r.id, r]));
    const hits: RecallHit[] = [];
    const defaultReasons: RecallReasons = {
      semantic: 0,
      recency: 0,
      frequency: 0,
      relevance: 0,
      pin: 0,
    };
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) continue; // RLS or status change dropped it — silently skip.
      const fact: MnemoFact = {
        id: r.id,
        workspaceId: r.workspace_id,
        agentId: r.agent_id,
        scope: r.scope as MnemoFact["scope"],
        scopeRef: r.scope_ref,
        kind: r.kind as MnemoFact["kind"],
        subject: r.subject,
        statement: r.statement,
        confidence: Number(r.confidence),
        pinned: r.pinned,
        relevance: Number(r.relevance),
        hitCount: Number(r.hit_count),
        lastRecalledAt: r.last_recalled_at ? new Date(r.last_recalled_at) : null,
        sourceMessageIds: r.source_message_ids ?? [],
        attributedTo: r.attributed_to,
        linkedMemoryIds: r.linked_memory_ids ?? [],
        embedding: null,
        metadata: r.metadata,
        status: r.status as MnemoFact["status"],
        mergedIntoId: r.merged_into_id,
        validFrom: new Date(r.valid_from),
        validTo: r.valid_to ? new Date(r.valid_to) : null,
        createdAt: new Date(r.created_at),
        updatedAt: new Date(r.updated_at),
        memoryType: ((r.memory_type ?? "semantic") as MnemoFact["memoryType"])!,
        attribution: ((r.attribution ?? "inferred") as MnemoFact["attribution"])!,
      };
      // We don't carry the original score / reasons across the L3
      // boundary — they're a function of the live `mnemo_fact` row
      // (recency/relevance/hit_count change after the cache write).
      // Returning a default-zero reasons object is honest: the score
      // is "cached, equivalence-class hit". Render layer treats this
      // the same as a regular RecallHit.
      hits.push({ fact, score: 0, reasons: defaultReasons });
    }

    // Async stat bump (fire-and-forget). We don't await the bump so
    // the recall path doesn't pay a round-trip for bookkeeping — pg-
    // boss style "best-effort" semantics.
    void tx
      .execute(
        sql`
          UPDATE mnemo_query_cache
          SET hit_count = hit_count + 1, last_used_at = now()
          WHERE id = ${row.id}
        `
      )
      .catch(() => {
        /* swallow — stat bump is non-essential */
      });

    return { hits, ageSeconds: row.age_seconds };
  } catch {
    // Cache lookup must NEVER break recall. Return null on any error
    // so the caller falls through to the full pipeline.
    return null;
  }
}

/**
 * v1.6 G1-4: persist a query → results mapping in the L3 cache.
 *
 * Idempotent on hash collisions (we use a deterministic id derived
 * from the workspace + query hash + scope cohort + top_k) via UPSERT.
 * Eviction: when row count for the workspace exceeds
 * `L3_MAX_PER_WORKSPACE`, drop everything older than 1h on insert.
 */
export async function setL3Cache(
  workspaceId: string,
  queryEmbedding: number[],
  hits: RecallHit[],
  tx: Tx,
  opts: {
    rowId: string; // deterministic id provided by the caller (see search.ts)
    scope?: string | null;
    scopeRef?: string | null;
    agentId?: string | null;
    topK: number;
  }
): Promise<void> {
  if (!queryEmbedding || queryEmbedding.length === 0) return;
  try {
    const vecLit = toVecLiteral(queryEmbedding);
    const ids = hits.map((h) => h.fact.id);
    const kinds = hits.map((h) => h.fact.kind);
    await tx.execute(sql`
      INSERT INTO mnemo_query_cache (
        id, workspace_id, query_embedding, result_memory_ids,
        result_memory_kinds, scope, scope_ref, agent_id, top_k,
        hit_count, last_used_at, created_at
      )
      VALUES (
        ${opts.rowId},
        ${workspaceId},
        ${vecLit}::vector(1536),
        ${sql.param(ids)}::text[],
        ${sql.param(kinds)}::text[],
        ${opts.scope ?? null},
        ${opts.scopeRef ?? null},
        ${opts.agentId ?? null},
        ${opts.topK},
        1,
        now(),
        now()
      )
      ON CONFLICT (id) DO UPDATE
        SET query_embedding = EXCLUDED.query_embedding,
            result_memory_ids = EXCLUDED.result_memory_ids,
            result_memory_kinds = EXCLUDED.result_memory_kinds,
            last_used_at = now(),
            hit_count = mnemo_query_cache.hit_count + 1
    `);

    // LRU-style eviction: if the workspace is over the cap, prune rows
    // older than 1h. Cheap — runs in a single statement, on-conflict
    // updates above keep hot rows fresh.
    const countRows = (await tx.execute(sql`
      SELECT count(*)::int AS n FROM mnemo_query_cache WHERE workspace_id = ${workspaceId}
    `)) as unknown as Array<{ n: number }>;
    const n = countRows[0]?.n ?? 0;
    if (n > L3_MAX_PER_WORKSPACE) {
      await tx.execute(sql`
        DELETE FROM mnemo_query_cache
        WHERE workspace_id = ${workspaceId}
          AND last_used_at < now() - interval '1 hour'
      `);
    }
  } catch {
    // Cache write must NEVER break recall. Swallow silently.
  }
}
