// packages/mnemosyne/src/recall/search.ts
//
// searchMnemo — hybrid recall over `mnemo_fact`. Spec §5 (hybrid retrieval).
//
// v1.0 pipeline (FTS or vector) → v1.1 full pipeline:
//
//   raw query
//      └─► query-prep: contextualize + HyDE          (recall/query-prep.ts)
//      └─► hybrid retrieval: FTS or vector, top K*5  (existing scoring)
//      └─► cross-encoder rerank: top K*2             (recall/rerank.ts)
//      └─► post-recall pruning: drop near-duplicates (cosine > 0.88)
//      └─► hard cap to `maxResults` (default 3, was 5 in v1.0)
//
// All v1.1 stages are OPT-IN: a plain `searchMnemo({ workspaceId, query })`
// runs the legacy pipeline unchanged, except for the `maxResults` default
// dropping from 5 → 3 (itself an anti-bloat improvement). Callers that
// depend on the v1.0 default can pass `maxResults: 5` explicitly.
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
   * v1.1 — friendly alias for `topK` with a new, tighter default of 3
   * (anti-bloat: v1.0 defaulted to 5; prompt-injection studies show 3
   * focused facts beat 5 noisy ones for downstream agent quality).
   * Callers that want the v1.0 behaviour can pass `maxResults: 5`.
   * Bounded at [1, 20].
   */
  maxResults?: number;
  /**
   * v1.1 — cosine similarity threshold for post-recall pruning. Facts
   * more similar than this to an already-kept fact are dropped. Default
   * 0.88 (empirically the elbow where near-duplicates dominate the
   * tail). Only used in Mode B/C — we need embeddings to measure cosine.
   */
  pruneRedundantThreshold?: number;
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
  /** v1.1 — pgvector stringified embedding, used by post-recall pruning */
  embedding?: string | null;
}

/** v1.1 — extends RecallHit with the parsed embedding for pruning. */
interface ScoredHit extends RecallHit {
  embedding: number[] | null;
}

/** Parse pgvector's textual form ("[0.1,0.2,...]") into a number[]. */
function parseEmbedding(s: string | null | undefined): number[] | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1);
  if (inner.length === 0) return null;
  const parts = inner.split(",");
  const out = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}

/** Standard cosine similarity. Returns 0 for zero-length or mismatched. */
function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Post-recall pruning: drop a fact when its embedding's cosine to ANY
 * already-kept fact exceeds `threshold`. Preserves the input (post-
 * rerank) order. Mode A facts (no embedding) are passed through — we
 * can't measure cosine without a vector, and dropping silently would
 * be worse than keeping a possible duplicate.
 */
function prunePostRecall(scored: ScoredHit[], threshold: number, maxResults: number): ScoredHit[] {
  const out: ScoredHit[] = [];
  for (const candidate of scored) {
    if (out.length >= maxResults) break;
    if (!candidate.embedding) {
      out.push(candidate);
      continue;
    }
    let redundant = false;
    for (const kept of out) {
      if (!kept.embedding) continue;
      const sim = cosineSim(candidate.embedding, kept.embedding);
      if (sim > threshold) {
        redundant = true;
        break;
      }
    }
    if (!redundant) out.push(candidate);
  }
  return out;
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
 * (over-fetched to give rerank+prune headroom — typically 5x the final cap).
 * Each `ScoredHit` carries the parsed embedding (Mode B/C) for the
 * downstream cosine-based pruning step; Mode A returns embedding: null.
 */
async function runFirstStage(
  input: SearchMnemoInput,
  tx: Tx,
  firstStageK: number,
  prepared: PreparedQuery
): Promise<ScoredHit[]> {
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

  // v1.1 — also pull the `embedding` column so the post-recall pruning
  // stage can measure cosine between candidates without an extra round-
  // trip. In Mode A we explicitly select NULL so the column shape stays
  // identical across both branches.
  const result = useFts
    ? await tx.execute(sql`
        SELECT
          id, workspace_id, agent_id, scope, scope_ref, kind, subject,
          statement, confidence, pinned, relevance, hit_count,
          last_recalled_at, source_message_ids, attributed_to,
          linked_memory_ids, metadata, status, merged_into_id,
          valid_from, valid_to, created_at, updated_at,
          NULL::text AS embedding,
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
          embedding::text AS embedding,
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

  const scored: ScoredHit[] = rows.map((r) => {
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
      embedding: parseEmbedding(r.embedding ?? null),
    };
  });

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Run the full v1.1 pipeline inside a transaction: first-stage retrieval
 * → cross-encoder rerank → post-recall pruning → hard cap.
 */
async function runSearchPipeline(
  input: SearchMnemoInput,
  tx: Tx,
  prepared: PreparedQuery,
  maxResults: number
): Promise<RecallHit[]> {
  // Over-fetch so the rerank+prune stages have headroom (5x the final
  // cap, floor 15 — empirically the elbow where deeper search stops
  // adding precision for our `mnemo_fact` cardinality).
  const firstStageK = Math.max(15, maxResults * 5);
  const firstStage = await runFirstStage(input, tx, firstStageK, prepared);

  // Hybrid-score sort so the reranker sees the strongest candidates first.
  firstStage.sort((a, b) => b.score - a.score);

  // Rerank pass. Budget = 2x final cap so the pruner has duplicates to
  // filter; the safe identity default just truncates to that budget.
  const rerankFn = input.rerank ?? noopRerank;
  const rerankK = Math.max(maxResults * 2, maxResults);
  const rerankIndices = await rerankFn({
    query: prepared.contextualized,
    documents: firstStage.map((h) => h.fact.statement),
    topK: rerankK,
  });
  const reranked: ScoredHit[] = [];
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

  // Post-recall pruning: drop facts that are near-duplicates of an
  // already-kept fact (cosine > threshold). Mode A facts pass through
  // (no embedding → can't measure). Hard-caps at `maxResults` as it goes.
  const threshold = input.pruneRedundantThreshold ?? 0.88;
  const pruned = prunePostRecall(postRerank, threshold, maxResults);

  // Strip the internal `embedding` field — it's never part of the
  // public RecallHit contract (the rowToFact mapper already sets
  // `fact.embedding: null` for the same reason).
  return pruned.map(({ embedding: _e, ...hit }) => hit);
}

/**
 * Hybrid recall over `mnemo_fact`. Returns the top-K ranked hits.
 *
 * v1.1 pipeline: query-prep (contextualize + HyDE) → first-stage hybrid
 * retrieval → cross-encoder rerank → post-recall pruning → hard cap.
 * All v1.1 stages are opt-in and degrade gracefully — recall NEVER
 * fails because of a flaky LLM, misbehaving reranker, or NULL embedding.
 *
 * The default cap is 3 (anti-bloat — v1.0 defaulted to 5). Set
 * `maxResults: 5` to restore the v1.0 default if a caller depends on it.
 *
 * Caller-supplied `tx` is used directly when present (the caller owns the
 * transaction lifecycle, e.g. when batching reads inside an existing
 * workspace tx). Otherwise a fresh workspace-scoped tx is opened so RLS
 * FORCE permits the SELECT.
 */
export async function searchMnemo(input: SearchMnemoInput): Promise<RecallHit[]> {
  // `maxResults` wins over legacy `topK`. Default is 3 (anti-bloat:
  // v1.0 defaulted to 5; prompt-injection studies show 3 focused facts
  // beat 5 noisy ones for downstream agent quality). Callers that need
  // the v1.0 behaviour can pass `maxResults: 5` explicitly.
  const requestedCap = input.maxResults ?? input.topK ?? 3;
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
