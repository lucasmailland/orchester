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
import type { FactKind, FactScope, FactStatus, MemoryType, MnemoFact } from "../primitives/fact";
import type { Attribution } from "../types";

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
  /**
   * v1.4 — when this hit was reached via 1-hop graph traversal from
   * another hit (rather than the direct hybrid-retrieval path), this
   * carries the parent's fact id. `undefined` / `null` means the hit
   * came from the direct retrieval. See `expandGraph` on
   * `SearchMnemoInput` for the activation flag.
   */
  expandedFromId?: string | null;
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
  /**
   * v1.4 — expand the top-K result set via 1-hop graph traversal over
   * `mnemo_relation`. When enabled, after the rerank+prune stage we
   * fetch facts connected to the top result via any of: `derived_from`,
   * `supersedes`, `part_of`, `member_of`, `scoped`, `related`. Each
   * neighbor's score is the parent's score × `expandDecay` (default 0.7).
   * Neighbors are deduplicated against the top-K and the hard cap is
   * re-applied. Hard cap on neighbors fetched: 10 per parent.
   *
   * Excluded verbs: `conflicts_with` (never expand into a contradiction),
   * `not_conflict` (low signal — explicit "not related" marker), and
   * `compatible` (too noisy).
   */
  expandGraph?: boolean;
  /**
   * v1.4 — multiplicative decay applied to a neighbor's score before it
   * competes with the direct hits. Default 0.7. Bounded at [0, 1].
   * `expandGraph` must also be true for this to take effect.
   */
  expandDecay?: number;
  /**
   * v1.2 — Bitemporal time-travel. Only return facts that were valid at
   * this point in time:
   *   - `undefined` (default): "currently valid" — `valid_to IS NULL
   *     OR valid_to > now()`. Backward compatible with the v1.0/v1.1
   *     contract (facts without an explicit valid_to are always live).
   *   - `Date`: snapshot view at that instant — `valid_from <= asOf
   *     AND (valid_to IS NULL OR valid_to > asOf)`. NULL `valid_to`
   *     is treated as +∞ so currently-live rows show up in any past
   *     snapshot taken after they were inserted.
   *
   * Bitemporal columns are populated by the existing insert path
   * (migration 0017+) and indexed by migration 0026
   * (`idx_mnemo_fact_valid` over `tstzrange(valid_from, valid_to)`),
   * so no schema change is needed for this feature.
   */
  asOf?: Date;
  /**
   * v1.4 — restrict recall to specific memory types. When unset, all
   * four types ('semantic' | 'episodic' | 'procedural' | 'working')
   * are searched (backward compatible with v1.3 callers). The most
   * common pattern is the agent runtime passing `['semantic',
   * 'episodic']` for factual user turns and `['procedural']` when
   * invoking a tool. An explicit empty array `[]` is treated as
   * "no filter" — same as unset — to avoid an accidental zero-row
   * trap from upstream `.filter()` chains.
   *
   * Wired into both the FTS and vector branches as
   *   `AND memory_type = ANY($types)`
   * which uses the (workspace_id, memory_type) partial index added
   * in migration 0033.
   */
  memoryTypes?: MemoryType[];
  /**
   * v1.4 — per-conversation actor isolation (migration 0037). When set,
   * recall is restricted to facts whose `actor_id` column matches the
   * supplied id OR is NULL (so workspace-shared facts remain visible).
   * Default: undefined — no filter (preserves v1.3 behaviour, every
   * fact in the workspace is recallable regardless of attribution).
   *
   * Wired into both the FTS and vector branches as:
   *   `AND (actor_id = $actorId OR actor_id IS NULL)`
   * which exploits the partial `idx_mnemo_fact_actor` index from
   * migration 0037 for the matched-actor leg; the NULL leg falls back
   * to the workspace scan, already covered by the workspace_id filter.
   */
  actorId?: string;
  /**
   * v1.4 — theory-of-mind attribution filter (migration 0035). When
   * set to a non-empty array, only facts whose `attribution` column
   * is IN this list are returned. Default: undefined / empty array →
   * no filter (preserves v1.3 behaviour). Common patterns:
   *   - `['user_stated']`         — only facts the user explicitly said.
   *   - `['user_stated','user_belief']` — the user's perspective.
   *   - `['objective_fact']`      — only canonical / verifiable facts.
   *
   * Wired into both the FTS and vector branches as
   *   `AND attribution = ANY($attributions)`
   * which is a small bitmap scan on a 4-value enum — the existing
   * (workspace_id, status) indexes already filter the bulk.
   */
  attributionFilter?: Attribution[];
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
  /** v1.4 — projected into the SELECT for both branches; defaulted at
   *  the SQL layer so legacy rows surface as 'semantic'. */
  memory_type: MemoryType;
  /** v1.4 — projected into the SELECT for both branches; defaulted at
   *  the SQL layer so legacy rows surface as 'inferred'. */
  attribution: Attribution;
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
    // v1.4 — defensive default to 'semantic' if the projection misses
    // the column (e.g. an older driver shim returning undefined for
    // unknown columns).
    memoryType: r.memory_type ?? "semantic",
    // v1.4 — defensive default to 'inferred' for the same reason as
    // `memoryType`. SQL DEFAULT already enforces this at insert time
    // for every legacy row.
    attribution: r.attribution ?? "inferred",
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

  // v1.2 — Bitemporal `asOf` filter. When `asOf` is unset the query
  // returns "currently valid" rows (`valid_to IS NULL OR valid_to >
  // now()`), preserving the v1.0/v1.1 contract that callers always
  // see the live snapshot. When set, the query returns the historical
  // view at that instant: `valid_from <= asOf AND (valid_to IS NULL
  // OR valid_to > asOf)`. Both branches use the same SQL fragment so
  // the GIST index `idx_mnemo_fact_valid` (migration 0026) over
  // `tstzrange(valid_from, valid_to)` can be exploited identically.
  const asOfFragment = input.asOf
    ? sql`AND valid_from <= ${input.asOf} AND (valid_to IS NULL OR valid_to > ${input.asOf})`
    : sql`AND (valid_to IS NULL OR valid_to > now())`;

  // v1.4 — Memory-type filter. When the caller passes a non-empty
  // `memoryTypes` array we restrict the result to that subset. An
  // empty array is treated as "no filter" (same as unset) to avoid
  // an accidental zero-row trap if a caller's upstream `.filter()`
  // chain produces an empty list. The (workspace_id, memory_type)
  // partial index from migration 0033 covers the bitmap scan.
  // Note: postgres-js requires an explicit ::text[] cast on the bound
  // array param — without it the driver sends the array as a single
  // scalar and Postgres reports `malformed array literal: "episodic"`.
  // We mirror the cast pattern used by the graph-expansion neighbor
  // query below (`sql.param(verbList)::text[]`).
  const memoryTypesFragment =
    input.memoryTypes && input.memoryTypes.length > 0
      ? sql`AND memory_type = ANY(${sql.param(input.memoryTypes)}::text[])`
      : sql``;

  // v1.1 — also pull the `embedding` column so the post-recall pruning
  // stage can measure cosine between candidates without an extra round-
  // trip. In Mode A we explicitly select NULL so the column shape stays
  // identical across both branches.
  // v1.4 — per-conversation actor isolation. When `actorId` is set we
  // include facts attributed to that actor PLUS workspace-shared facts
  // (`actor_id IS NULL`). When unset the column is ignored — preserves
  // v1.3 behaviour where every workspace fact is visible. Uses the
  // partial `idx_mnemo_fact_actor` index from migration 0037 for the
  // matched-actor leg; the NULL leg falls back to the workspace scan.
  const actorIdFragment = input.actorId
    ? sql`AND (actor_id = ${input.actorId} OR actor_id IS NULL)`
    : sql``;

  // v1.4 — theory-of-mind attribution filter. Empty array is treated
  // as "no filter" so callers building the list dynamically don't
  // have to special-case the empty case (e.g. when a UI filter pill
  // chain returns []). The 4-value enum stays cheap to scan.
  const attributionFragment =
    input.attributionFilter && input.attributionFilter.length > 0
      ? sql`AND attribution = ANY(${sql.param(input.attributionFilter)}::text[])`
      : sql``;

  const result = useFts
    ? await tx.execute(sql`
        SELECT
          id, workspace_id, agent_id, scope, scope_ref, kind, subject,
          statement, confidence, pinned, relevance, hit_count,
          last_recalled_at, source_message_ids, attributed_to,
          linked_memory_ids, metadata, status, merged_into_id,
          valid_from, valid_to, created_at, updated_at, memory_type, attribution,
          NULL::text AS embedding,
          ts_rank_cd(text_lemmatized, plainto_tsquery('simple', ${lexicalQuery})) AS fts_score,
          exp(-LN(2.0) * EXTRACT(EPOCH FROM (now() - created_at)) / (30.0 * 86400.0)) AS recency,
          (ln(1.0 + hit_count) / ln(100.0)) AS frequency,
          CASE WHEN pinned THEN 1.0 ELSE 0.0 END AS pin_bonus
        FROM mnemo_fact
        WHERE workspace_id = ${input.workspaceId}
          AND status = 'active'
          AND text_lemmatized @@ plainto_tsquery('simple', ${lexicalQuery})
          ${asOfFragment}
          ${memoryTypesFragment}
          ${actorIdFragment}
          ${attributionFragment}
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
          valid_from, valid_to, created_at, updated_at, memory_type, attribution,
          embedding::text AS embedding,
          (1.0 - (embedding <=> ${vecLiteral}::vector)) AS semantic,
          exp(-LN(2.0) * EXTRACT(EPOCH FROM (now() - created_at)) / (30.0 * 86400.0)) AS recency,
          (ln(1.0 + hit_count) / ln(100.0)) AS frequency,
          CASE WHEN pinned THEN 1.0 ELSE 0.0 END AS pin_bonus
        FROM mnemo_fact
        WHERE workspace_id = ${input.workspaceId}
          AND status = 'active'
          AND embedding IS NOT NULL
          ${asOfFragment}
          ${memoryTypesFragment}
          ${actorIdFragment}
          ${attributionFragment}
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

  // v1.4 — opt-in 1-hop graph expansion. Pruned (and capped) hits act
  // as the parent set. We over-fetch neighbors (decay-discounted) and
  // re-apply the hard cap so a stronger neighbor can crowd out a
  // weaker direct hit. Bounded at 10 neighbors per parent to keep the
  // tail tractable; the cap re-applies at the end so the user-facing
  // result count never exceeds `maxResults`.
  let expanded: ScoredHit[] = pruned;
  if (input.expandGraph && pruned.length > 0) {
    const decay = clamp01ish(input.expandDecay ?? 0.7);
    const neighbors = await fetchOneHopNeighbors(pruned, input.workspaceId, tx, decay);
    if (neighbors.length > 0) {
      // Dedup neighbors against the parents AND against each other —
      // the same fact may be reachable from two parents; keep the
      // higher-scored one (we iterated parents by score, so first-wins
      // already biases toward stronger parents).
      const seenIds = new Set(pruned.map((h) => h.fact.id));
      const dedupedNeighbors: ScoredHit[] = [];
      for (const n of neighbors) {
        if (seenIds.has(n.fact.id)) continue;
        seenIds.add(n.fact.id);
        dedupedNeighbors.push(n);
      }
      // Concat + sort by score so neighbors can promote past direct
      // hits when their parent was very high. Re-apply the hard cap.
      const combined = [...pruned, ...dedupedNeighbors];
      combined.sort((a, b) => b.score - a.score);
      expanded = combined.slice(0, maxResults);
    }
  }

  // Strip the internal `embedding` field — it's never part of the
  // public RecallHit contract (the rowToFact mapper already sets
  // `fact.embedding: null` for the same reason).
  return expanded.map(({ embedding: _e, ...hit }) => hit);
}

/**
 * Clamp a decay factor to [0, 1]. Anything else (NaN, negative, > 1)
 * collapses to the safe defaults so a misconfigured caller can't blow
 * up the ranking. Centralised here so the public option stays a plain
 * `number` without zod overhead.
 */
function clamp01ish(n: number): number {
  if (!Number.isFinite(n)) return 0.7;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** v1.4 — verbs we DO expand into. Locked subset of the 9-verb
 *  vocabulary; the excluded set (`conflicts_with`, `not_conflict`,
 *  `compatible`) is documented on the `expandGraph` field of
 *  `SearchMnemoInput`. Kept private — the list IS the contract. */
const EXPAND_VERBS = [
  "derived_from",
  "supersedes",
  "part_of",
  "member_of",
  "scoped",
  "related",
] as const;

/** Hard cap on neighbors fetched per parent to keep the second-stage
 *  query bounded on hub-like facts (a single fact with hundreds of
 *  edges would otherwise dominate the result set). */
const MAX_NEIGHBORS_PER_PARENT = 10;

interface RelationEdgeRow {
  src_id: string;
  dst_id: string;
  verb: string;
}

/**
 * Pull every neighbor reachable in 1 hop from `parents` via the
 * whitelisted verbs and hydrate them into ScoredHit rows. Score is the
 * parent's score × decay; reasons are inherited from the parent so the
 * downstream caller (render layer) can still explain the hit if it
 * wants. `expandedFromId` is stamped so callers can distinguish direct
 * hits from graph hops.
 *
 * Two queries: (1) the relation lookup constrained to the whitelisted
 * verb set + parent ids; (2) a single hydration SELECT against
 * `mnemo_fact` for the distinct neighbor ids. The relations table is
 * RLS-gated by the workspace GUC just like `mnemo_fact`, so no
 * explicit workspace_id is needed in the WHERE — we add it anyway as
 * defense-in-depth and to help the planner pick the right index.
 *
 * Returns rows in PARENT order, so dedup-first-wins biases toward the
 * strongest parent's neighbor. Mode A and Mode B/C both work — the
 * hydration query carries the same column shape we already use, with
 * NULL embedding so the post-recall pruner cannot drop neighbors a
 * second time (we want them in the final mix).
 */
async function fetchOneHopNeighbors(
  parents: ScoredHit[],
  workspaceId: string,
  tx: Tx,
  decay: number
): Promise<ScoredHit[]> {
  if (parents.length === 0 || decay === 0) return [];
  const parentIds = parents.map((p) => p.fact.id);
  const verbList = Array.from(EXPAND_VERBS);

  // ── 1. relation edges ────────────────────────────────────────────
  // source_kind is hardcoded 'fact' — the brief scopes v1.4 expansion
  // to fact→fact edges; decision/episode expansion stays out of the
  // contract until E1's mnemo_episode lands. We also filter target_kind
  // to 'fact' so we don't accidentally hydrate decision ids against
  // `mnemo_fact` (would return zero rows but wastes the round-trip).
  const edgeResult = await tx.execute(sql`
    SELECT source_id AS src_id, target_id AS dst_id, relation AS verb
    FROM mnemo_relation
    WHERE workspace_id = ${workspaceId}
      AND source_kind = 'fact'
      AND target_kind = 'fact'
      AND source_id = ANY(${sql.param(parentIds)}::text[])
      AND relation = ANY(${sql.param(verbList)}::text[])
  `);
  const edges = edgeResult as unknown as RelationEdgeRow[];
  if (edges.length === 0) return [];

  // Map parent.id → first MAX_NEIGHBORS_PER_PARENT neighbor ids. We
  // walk edges in arrival order, so a hub fact's tail just gets
  // truncated rather than dropping signal randomly.
  const neighborIdsByParent = new Map<string, string[]>();
  for (const e of edges) {
    let arr = neighborIdsByParent.get(e.src_id);
    if (!arr) {
      arr = [];
      neighborIdsByParent.set(e.src_id, arr);
    }
    if (arr.length < MAX_NEIGHBORS_PER_PARENT) arr.push(e.dst_id);
  }

  // Distinct neighbor ids across all parents — used for the single
  // hydration query below. A neighbor reachable from two parents is
  // fetched ONCE and attributed to its first parent (by score order).
  const distinctNeighborIds = Array.from(new Set(edges.map((e) => e.dst_id)));
  if (distinctNeighborIds.length === 0) return [];

  // ── 2. hydrate neighbor facts ─────────────────────────────────────
  // Same SELECT shape as the FTS branch of runFirstStage minus the
  // score columns — recency / frequency / pin_bonus are recomputed
  // server-side so the inherited score isn't a stale snapshot.
  // `status='active'` matches the direct-hit filter; we don't want to
  // surface forgotten facts via expansion.
  const hydrationResult = await tx.execute(sql`
    SELECT
      id, workspace_id, agent_id, scope, scope_ref, kind, subject,
      statement, confidence, pinned, relevance, hit_count,
      last_recalled_at, source_message_ids, attributed_to,
      linked_memory_ids, metadata, status, merged_into_id,
      valid_from, valid_to, created_at, updated_at, memory_type,
      NULL::text AS embedding,
      0.0 AS fts_score,
      exp(-LN(2.0) * EXTRACT(EPOCH FROM (now() - created_at)) / (30.0 * 86400.0)) AS recency,
      (ln(1.0 + hit_count) / ln(100.0)) AS frequency,
      CASE WHEN pinned THEN 1.0 ELSE 0.0 END AS pin_bonus
    FROM mnemo_fact
    WHERE workspace_id = ${workspaceId}
      AND status = 'active'
      AND (valid_to IS NULL OR valid_to > now())
      AND id = ANY(${sql.param(distinctNeighborIds)}::text[])
  `);
  const hydrationRows = hydrationResult as unknown as FactRow[];
  if (hydrationRows.length === 0) return [];

  const factById = new Map<string, FactRow>();
  for (const r of hydrationRows) factById.set(r.id, r);

  // ── 3. assemble ScoredHits in parent-score order ─────────────────
  // First-wins dedup: if the same neighbor is reachable from p1 (high
  // score) and p2 (lower), we keep the p1 attribution. Caller's
  // `seenIds` set in `runSearchPipeline` enforces this between
  // direct-hit and neighbor sets; we enforce it WITHIN the neighbor
  // set here.
  const out: ScoredHit[] = [];
  const seenNeighbors = new Set<string>();
  for (const parent of parents) {
    const ids = neighborIdsByParent.get(parent.fact.id);
    if (!ids) continue;
    for (const id of ids) {
      if (seenNeighbors.has(id)) continue;
      const row = factById.get(id);
      if (!row) continue; // hydration dropped it (RLS / status mismatch).
      seenNeighbors.add(id);
      out.push({
        fact: rowToFact(row),
        score: parent.score * decay,
        // Inherit the parent's reasons so the render layer can still
        // explain "why this fact was relevant" — the expansion is a
        // proximity claim, not a fresh ranking signal.
        reasons: parent.reasons,
        embedding: null,
        expandedFromId: parent.fact.id,
      });
    }
  }
  return out;
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
  // v1.2 — mix `asOf` into the hash so a time-travel query never collides
  // with the present-day equivalent. `current` is a safe sentinel for the
  // default no-asOf case; using a fixed string keeps the present-day
  // cache hot across calls (we don't want `now()` ticks to invalidate it).
  const cacheQuery = prepared.hypothetical ?? prepared.contextualized;
  const asOfTag = input.asOf ? input.asOf.toISOString() : "current";
  // v1.4 — mix `memoryTypes` into the hash so a typed query never
  // collides with the "all types" query for the same text. Sort first
  // so `['episodic','semantic']` and `['semantic','episodic']` share
  // the same cache bucket. Empty array / undefined → 'all' sentinel.
  const memTypesTag =
    input.memoryTypes && input.memoryTypes.length > 0
      ? [...input.memoryTypes].sort().join(",")
      : "all";
  // v1.4 — mix `actorId` into the hash so a per-actor recall never
  // collides with the workspace-wide one (different result sets). The
  // "all" sentinel matches the no-actor default; using a fixed string
  // keeps the workspace-wide cache hot across calls.
  const actorTag = input.actorId ?? "all";
  const queryHash = createHash("sha256")
    .update(cacheQuery)
    .update("\x00")
    .update(asOfTag)
    .update("\x00")
    .update(memTypesTag)
    .update("\x00")
    .update(actorTag)
    .digest("hex")
    .slice(0, 16);
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
