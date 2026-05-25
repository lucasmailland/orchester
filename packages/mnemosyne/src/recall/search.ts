// packages/mnemosyne/src/recall/search.ts
//
// searchMnemo — hybrid recall over `mnemo_fact`. Spec §5 (hybrid retrieval).
//
// v1.0 pipeline (FTS or vector) → v1.1 adds an opt-in query-prep stage
// (contextualization + HyDE) BEFORE first-stage retrieval. The query-fact
// embedding mismatch (questions vs. statements live in different vector-
// space regions) is the primary recall-precision bug from the v1.0 audit
// — HyDE is the fix: ask the LLM for a hypothetical statement-style
// answer, embed THAT, and you land next to the right stored fact.
//
// Subsequent v1.1 commits add reranking, post-recall pruning, and the
// hard cap on `maxResults`. This commit only touches the query path.
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
//
// §0.1: package-clean — no `server-only`, no path aliases to the host
// app. Embedding / LLM / reranker are all dependency-injected.
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { embedMnemo, type EmbedFn, type EmbeddingProvider } from "./embed";
import { recallCache, recallCacheKey } from "./cache";
import { prepareQuery, type LlmCallFn, type PreparedQuery } from "./query-prep";
import { noopRerank, type RerankFn } from "./rerank";
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
  /**
   * Legacy alias for `maxResults`. If both are set, `maxResults` wins.
   * Kept for backward compat with v1.0 callers.
   */
  topK?: number;
  /**
   * v1.1 — friendly alias for `topK`. Future commits will tighten the
   * default and add anti-bloat caps; in this commit it's a transparent
   * rename so callers can adopt the v1.1 vocabulary now.
   */
  maxResults?: number;
  /**
   * Optional embedding provider/model/fn. If all three are provided, the
   * search runs in Mode B/C (vector path). Otherwise it falls back to
   * Mode A (FTS path) — Charter §25 / §39 graceful degradation.
   */
  embeddingProvider?: EmbeddingProvider;
  embeddingModel?: string;
  embedFn?: EmbedFn;
  /**
   * v1.1 — Conversation history for query contextualization. If absent
   * or shorter than 2 turns, contextualization is skipped (the raw
   * query IS the self-contained query).
   */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** v1.1 — Toggle HyDE. Default: true if `prepareQueryLlm` is provided. */
  enableHyDE?: boolean;
  /** v1.1 — Toggle query contextualization. Default: true if LLM provided. */
  enableContextualize?: boolean;
  /**
   * v1.1 — Host-provided cheap-model caller for query-prep. If absent,
   * both contextualization and HyDE are skipped — recall runs unchanged.
   */
  prepareQueryLlm?: LlmCallFn;
  /**
   * v1.1 — Optional cross-encoder reranker. If absent, identity rerank
   * (just truncates to topK*2). See `./rerank.ts` for the Cohere helper
   * `makeCohereRerank`. Charter §25: model/provider injected, never
   * hardcoded in mnemosyne.
   */
  rerank?: RerankFn;
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

/**
 * First-stage retrieval: FTS or vector hybrid, returns top `firstStageK`
 * (over-fetched to give rerank headroom — typically 5x the final cap).
 */
async function runFirstStage(
  input: SearchMnemoInput,
  tx: Tx,
  firstStageK: number,
  prepared: PreparedQuery
): Promise<RecallHit[]> {
  // v1.1: embed the HyDE hypothetical if present, otherwise the
  // contextualized query. The lexical (FTS) query always uses the
  // contextualized form (HyDE text would be too specific for FTS).
  const embeddingQuery = prepared.hypothetical ?? prepared.contextualized;
  const lexicalQuery = prepared.contextualized;

  let queryVec: number[] | undefined;
  if (input.embeddingProvider && input.embeddingModel && input.embedFn) {
    const vecs = await embedMnemo({
      workspaceId: input.workspaceId,
      texts: [embeddingQuery],
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
          ts_rank_cd(text_lemmatized, plainto_tsquery('simple', ${lexicalQuery})) AS fts_score,
          exp(-LN(2.0) * EXTRACT(EPOCH FROM (now() - created_at)) / (30.0 * 86400.0)) AS recency,
          (ln(1.0 + hit_count) / ln(100.0)) AS frequency,
          CASE WHEN pinned THEN 1.0 ELSE 0.0 END AS pin_bonus
        FROM mnemo_fact
        WHERE workspace_id = ${input.workspaceId}
          AND status = 'active'
          AND text_lemmatized @@ plainto_tsquery('simple', ${lexicalQuery})
          ${input.agentId ? sql`AND (agent_id = ${input.agentId} OR agent_id IS NULL)` : sql``}
          ${input.scope ? sql`AND scope = ${input.scope}` : sql``}
          ${input.scopeRef ? sql`AND scope_ref = ${input.scopeRef}` : sql``}
        ORDER BY fts_score DESC
        LIMIT ${firstStageK}
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
        LIMIT ${firstStageK}
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

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Run the full v1.1 pipeline inside a transaction: first-stage retrieval
 * → cross-encoder rerank → hard cap. Pruning lands in a later commit.
 */
async function runSearchPipeline(
  input: SearchMnemoInput,
  tx: Tx,
  prepared: PreparedQuery,
  maxResults: number
): Promise<RecallHit[]> {
  // Over-fetch so the rerank has headroom (5x the final cap, floor 15).
  const firstStageK = Math.max(15, maxResults * 5);
  const firstStage = await runFirstStage(input, tx, firstStageK, prepared);

  // Rerank pass. Budget = 2x final cap; the safe identity default just
  // truncates to that budget without touching order.
  const rerankFn = input.rerank ?? noopRerank;
  const rerankK = Math.max(maxResults * 2, maxResults);
  const rerankIndices = await rerankFn({
    query: prepared.contextualized,
    documents: firstStage.map((h) => h.fact.statement),
    topK: rerankK,
  });
  const reranked: RecallHit[] = [];
  const seen = new Set<number>();
  for (const i of rerankIndices) {
    if (seen.has(i)) continue;
    seen.add(i);
    const h = firstStage[i];
    if (h) reranked.push(h);
  }
  // Defensive: misbehaving custom RerankFn that returns nothing → fall
  // back to the hybrid-scored order. (noopRerank can't hit this path.)
  const postRerank = reranked.length > 0 ? reranked : firstStage.slice(0, rerankK);

  return postRerank.slice(0, maxResults);
}

/**
 * Hybrid recall over `mnemo_fact`. Returns the top-K ranked hits.
 *
 * v1.1 pipeline: query-prep (contextualize + HyDE) → first-stage hybrid
 * retrieval → cross-encoder rerank → hard cap. All v1.1 stages are
 * opt-in and degrade gracefully — recall NEVER fails because of a
 * flaky LLM or a misbehaving reranker.
 *
 * Caller-supplied `tx` is used directly when present (the caller owns the
 * transaction lifecycle, e.g. when batching reads inside an existing
 * workspace tx). Otherwise a fresh workspace-scoped tx is opened so RLS
 * FORCE permits the SELECT.
 */
export async function searchMnemo(input: SearchMnemoInput): Promise<RecallHit[]> {
  // `maxResults` wins over legacy `topK`. Default 5 in this commit;
  // a later commit will tighten it to 3 as an anti-bloat measure.
  const requestedCap = input.maxResults ?? input.topK ?? 5;
  const topK = Math.min(Math.max(requestedCap, 1), 20);

  // v1.1 query-prep. Defaults: enabled when LLM is supplied. No LLM → identity.
  const prepared = await prepareQuery({
    rawUserTurn: input.query,
    history: input.history,
    llm: input.prepareQueryLlm,
    enableHyDE: input.enableHyDE,
    enableContextualize: input.enableContextualize,
  });

  // Cache key: keyed on the prepared query (HyDE-or-contextualized) so
  // two callers with the same raw turn but different history don't collide.
  const cacheQuery = prepared.hypothetical ?? prepared.contextualized;
  const queryHash = createHash("sha256").update(cacheQuery).digest("hex").slice(0, 16);
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
    ? await runSearchPipeline(input, input.tx, prepared, topK)
    : await withMnemoTx(input.workspaceId, (tx) =>
        runSearchPipeline(input, tx as Tx, prepared, topK)
      );

  recallCache.set(cacheK, hits as unknown as object);
  return hits;
}
