// packages/mnemosyne/src/recall/search.ts
//
// searchMnemo — hybrid recall over `mnemo_fact`. Spec §5 (hybrid retrieval).
//
// Scoring (mirrors apps/web/lib/brain/recall.ts so the formulas stay aligned
// across the two storage homes during the brain → mnemo migration window):
//
// Mode A (no embedding provider) — FTS path:
//     score = 0.6 * fts        (clamped to [0,1])
//           + 0.2 * recency    (true half-life H=30d)
//           + 0.1 * frequency  (log scale, hit_count)
//           + 0.1 * pin_bonus
//
// Mode B / C (with embedding) — hybrid path:
//     score = 0.50 * semantic    (pgvector cosine, 1 - distance)
//           + 0.15 * recency     (true half-life: exp(-ln(2) * age_days / 30))
//           + 0.10 * frequency   (log(1 + hit_count) / log(100))
//           + 0.20 * relevance   (decay-adjusted, true half-life — same H)
//           + 0.05 * pin_bonus
//
// Recency and `relevance` MUST share the same decay model so they live on
// the same numeric scale when blended. Both use true half-life with H=30d.
//
// Cache: L1 = in-process LRU via ./cache.ts (60s TTL, workspace-scoped).
// L2 (embedding) lives inside `embedMnemo`. L3 (`mnemo_query_cache`) is
// intentionally unwired in v1.0 — see TODO below.
//
// TODO(v1.1): L3 query cache. `mnemo_query_cache` table exists (migration
// 0022) and is meant to short-circuit semantically-similar queries via
// cosine > 0.95 over 24h. Currently only L1 LRU is wired in this file.
// Wiring L3 requires: (a) embedding the query (already done below for
// Mode B/C, would need a Mode A bypass since Mode A has no embedding),
// (b) a similarity probe against `mnemo_query_cache.query_embedding`
// inside the same workspace tx, (c) write-back of (queryEmbedding,
// resultIds, kinds) on miss with `top_k` matching the request. Skipped
// in v1.0 to keep the recall hot path small while the rest of the
// package stabilises.
//
// §0.1: package-clean — no `server-only`, no path aliases to the host
// app. Embedding is dependency-injected via `embedFn` like the rest of
// mnemosyne.
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { embedMnemo, type EmbedFn, type EmbeddingProvider } from "./embed";
import { recallCache, recallCacheKey } from "./cache";
import { withMnemoTx, type Tx } from "../tx";
import type { FactKind, FactScope, FactStatus, MnemoFact } from "../primitives/fact";

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
}

export interface SearchMnemoInput {
  workspaceId: string;
  query: string;
  agentId?: string;
  scope?: FactScope;
  scopeRef?: string;
  topK?: number;
  /**
   * Optional embedding provider/model/fn. If all three are provided, the
   * search runs in Mode B/C (vector path). Otherwise it falls back to
   * Mode A (FTS path) — Charter §25 / §39 graceful degradation.
   */
  embeddingProvider?: EmbeddingProvider;
  embeddingModel?: string;
  embedFn?: EmbedFn;
  /**
   * Optional transaction. If supplied, the search runs inside it. If
   * omitted, a workspace-scoped tx is opened via `withMnemoTx` so RLS
   * FORCE allows the SELECT.
   */
  tx?: Tx;
}

interface FactRow {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  scope: FactScope;
  scope_ref: string | null;
  kind: FactKind;
  subject: string;
  statement: string;
  confidence: number;
  pinned: boolean;
  relevance: number;
  hit_count: number;
  last_recalled_at: string | null;
  source_message_ids: string[];
  attributed_to: "user" | "assistant" | "system" | null;
  linked_memory_ids: string[];
  metadata: Record<string, unknown>;
  status: FactStatus;
  merged_into_id: string | null;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
  updated_at: string;
  semantic?: number;
  fts_score?: number;
  recency: number;
  frequency: number;
  pin_bonus: number;
}

function rowToFact(r: FactRow): MnemoFact {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    agentId: r.agent_id,
    scope: r.scope,
    scopeRef: r.scope_ref,
    kind: r.kind,
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
    status: r.status,
    mergedIntoId: r.merged_into_id,
    validFrom: new Date(r.valid_from),
    validTo: r.valid_to ? new Date(r.valid_to) : null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

async function runSearch(input: SearchMnemoInput, tx: Tx, topK: number): Promise<RecallHit[]> {
  // Resolve query vector (Mode A → `[]` from embedMnemo when no embedFn
  // supplied; we treat that as FTS fallback).
  let queryVec: number[] | undefined;
  if (input.embeddingProvider && input.embeddingModel && input.embedFn) {
    const vecs = await embedMnemo({
      workspaceId: input.workspaceId,
      texts: [input.query],
      provider: input.embeddingProvider,
      model: input.embeddingModel,
      embedFn: input.embedFn,
      tx: tx as never,
    });
    queryVec = vecs[0];
  }

  const vecLiteral = queryVec && queryVec.length > 0 ? `[${queryVec.join(",")}]` : null;
  const useFts = vecLiteral === null;

  const result = useFts
    ? await tx.execute(sql`
        SELECT
          id, workspace_id, agent_id, scope, scope_ref, kind, subject,
          statement, confidence, pinned, relevance, hit_count,
          last_recalled_at, source_message_ids, attributed_to,
          linked_memory_ids, metadata, status, merged_into_id,
          valid_from, valid_to, created_at, updated_at,
          ts_rank_cd(text_lemmatized, plainto_tsquery('simple', ${input.query})) AS fts_score,
          exp(-LN(2.0) * EXTRACT(EPOCH FROM (now() - created_at)) / (30.0 * 86400.0)) AS recency,
          (ln(1.0 + hit_count) / ln(100.0)) AS frequency,
          CASE WHEN pinned THEN 1.0 ELSE 0.0 END AS pin_bonus
        FROM mnemo_fact
        WHERE workspace_id = ${input.workspaceId}
          AND status = 'active'
          AND text_lemmatized @@ plainto_tsquery('simple', ${input.query})
          ${input.agentId ? sql`AND (agent_id = ${input.agentId} OR agent_id IS NULL)` : sql``}
          ${input.scope ? sql`AND scope = ${input.scope}` : sql``}
          ${input.scopeRef ? sql`AND scope_ref = ${input.scopeRef}` : sql``}
        ORDER BY fts_score DESC
        LIMIT ${topK * 3}
      `)
    : await tx.execute(sql`
        SELECT
          id, workspace_id, agent_id, scope, scope_ref, kind, subject,
          statement, confidence, pinned, relevance, hit_count,
          last_recalled_at, source_message_ids, attributed_to,
          linked_memory_ids, metadata, status, merged_into_id,
          valid_from, valid_to, created_at, updated_at,
          (1.0 - (embedding <=> ${vecLiteral}::vector)) AS semantic,
          exp(-LN(2.0) * EXTRACT(EPOCH FROM (now() - created_at)) / (30.0 * 86400.0)) AS recency,
          (ln(1.0 + hit_count) / ln(100.0)) AS frequency,
          CASE WHEN pinned THEN 1.0 ELSE 0.0 END AS pin_bonus
        FROM mnemo_fact
        WHERE workspace_id = ${input.workspaceId}
          AND status = 'active'
          AND embedding IS NOT NULL
          ${input.agentId ? sql`AND (agent_id = ${input.agentId} OR agent_id IS NULL)` : sql``}
          ${input.scope ? sql`AND scope = ${input.scope}` : sql``}
          ${input.scopeRef ? sql`AND scope_ref = ${input.scopeRef}` : sql``}
        ORDER BY embedding <=> ${vecLiteral}::vector
        LIMIT ${topK * 3}
      `);

  // postgres-js returns rows directly when iterated.
  const rows = result as unknown as FactRow[];

  const scored: RecallHit[] = rows.map((r) => {
    const semantic = Number(r.semantic ?? 0);
    const fts = Number(r.fts_score ?? 0);
    const recency = Number(r.recency);
    const frequency = Number(r.frequency);
    const relevance = Number(r.relevance);
    const pin = Number(r.pin_bonus);
    const score = useFts
      ? 0.6 * Math.min(1, fts) + 0.2 * recency + 0.1 * frequency + 0.1 * pin
      : 0.5 * semantic + 0.15 * recency + 0.1 * frequency + 0.2 * relevance + 0.05 * pin;
    return {
      fact: rowToFact(r),
      score,
      reasons: { semantic, recency, frequency, relevance, pin },
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

/**
 * Hybrid recall over `mnemo_fact`. Returns the top-K ranked hits.
 *
 * Caller-supplied `tx` is used directly when present (the caller owns the
 * transaction lifecycle, e.g. when batching reads inside an existing
 * workspace tx). Otherwise a fresh workspace-scoped tx is opened so RLS
 * FORCE permits the SELECT.
 */
export async function searchMnemo(input: SearchMnemoInput): Promise<RecallHit[]> {
  const topK = Math.min(Math.max(input.topK ?? 5, 1), 20);

  const queryHash = createHash("sha256").update(input.query).digest("hex").slice(0, 16);
  const cacheK = recallCacheKey({
    workspaceId: input.workspaceId,
    queryHash,
    scope: input.scope ?? null,
    scopeRef: input.scopeRef ?? null,
    topK,
    agentId: input.agentId ?? null,
  });

  const cached = recallCache.get(cacheK) as RecallHit[] | undefined;
  if (cached) return cached;

  const hits = input.tx
    ? await runSearch(input, input.tx, topK)
    : await withMnemoTx(input.workspaceId, (tx) => runSearch(input, tx as Tx, topK));

  recallCache.set(cacheK, hits as unknown as object);
  return hits;
}
