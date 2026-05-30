// packages/mnemosyne/src/recall/search.ts
//
// searchMnemo — hybrid recall over `mnemo_fact`. Spec §5 (hybrid retrieval).
//
// v1.0 pipeline (FTS or vector) → v1.1 full pipeline:
//
//   raw query
//      └─► query-prep: contextualize + HyDE          (recall/query-prep.ts)
//      └─► #1+2 pointer lookup → drawer entity IDs   (index/pointer.ts)
//      └─► #1+2 drawer-grep: FTS within entity IDs   (runDrawerGrep)
//      └─► hybrid retrieval: FTS or vector, top K*5  (runFirstStage)
//      └─► #1+2 merge: union drawer + full results   (mergeHitPools)
//      └─► cross-encoder rerank: top K*2             (recall/rerank.ts)
//      └─► post-recall pruning: drop near-duplicates (cosine > 0.88)
//      └─► hard cap to `maxResults` (default 3, was 5 in v1.0)
//
// All v1.1 stages are OPT-IN: a plain `searchMnemo({ workspaceId, query })`
// runs the legacy pipeline unchanged, except for the `maxResults` default
// dropping from 5 → 3 (itself an anti-bloat improvement). Callers that
// depend on the v1.0 default can pass `maxResults: 5` explicitly.
//
// v1.1 #25 — adaptive recall budget: the requested cap is further
// constrained per-workspace by `tieredCap(requested, factCount)` so
// tiny workspaces don't waste budget on noise and large workspaces
// can fully use the 20-row ceiling. The count is fetched (with a
// 5-min LRU) inside `runSearchPipeline` so it shares the pipeline tx.
//
// Scoring (mirrors apps/web/lib/brain/recall.ts so the formulas stay aligned
// across the two storage homes during the brain → mnemo migration window):
//
// Mode A (no embedding provider) — FTS path:
//     score = 0.60 * fts        (clamped to [0,1])
//           + 0.20 * recency    (true half-life H=30d)
//           + 0.10 * frequency  (log scale, hit_count)
//           + 0.10 * pin_bonus
//           + 0.05 * strength   (v1.1 #10 — memory_strength / 5.0)
//
// Mode B / C (with embedding) — hybrid path:
//     hybrid   = 0.70 * semantic + 0.30 * fts_normalized       (v1.1 — #3)
//     score    = 0.50 * hybrid     (BM25+vector fusion — see below)
//              + 0.15 * recency     (true half-life: exp(-ln(2) * age_days / 30))
//              + 0.10 * frequency   (log(1 + hit_count) / log(100))
//              + 0.20 * relevance   (decay-adjusted, true half-life — same H)
//              + 0.05 * pin_bonus
//              + 0.05 * strength    (v1.1 #10 — memory_strength / 5.0)
//
// v1.1 — #3: the vector branch now ALSO runs ts_rank_cd as a projected
// column and fuses BM25 with cosine before the weighted scoring. Before
// v1.1 the vector branch was pure cosine, which fails silently for
// code/log/diff queries whose embeddings are noisy but whose lexical
// signal is strong. `fts_normalized = min(1, ts_rank_cd)` — empirically
// ts_rank_cd saturates well below 1 for short queries, so the simple
// clamp matches what the FTS-only branch does. The vector WHERE does
// NOT add an FTS-match gate (otherwise we'd lose all-semantic recall);
// non-matching rows just get fts=0 and the formula degrades to pure
// semantic with a 0.3 weight haircut, which is the desired behaviour
// for a lexically-bare semantic match.
//
// Recency and `relevance` MUST share the same decay model so they live on
// the same numeric scale when blended. Both use true half-life with H=30d.
//
// Cache layers (all wired in v1.6):
//   - L1: in-process LRU via ./cache.ts (60s TTL, workspace-scoped, ~5K entries).
//   - L2: embedding cache lives inside `embedMnemo` (workspace-keyed LRU).
//   - L3: `mnemo_query_cache` table — semantic-similar query cache.
//     Cosine ≥ 0.95 lookup within 5min TTL, per-workspace 1000-row cap.
//     Wired via getL3Cache + setL3Cache from ./cache.ts. Only fires when
//     `asOf` is unset (time-travel queries bypass L3 — historical state
//     must come from the live SQL).
//
// §0.1: package-clean — no `server-only`, no path aliases to the host
// app. Embedding / LLM / reranker are all dependency-injected.
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { embedMnemo, type EmbedFn, type EmbeddingProvider } from "./embed";
import { recallCache, recallCacheKey, getL3Cache, setL3Cache, getCachedFactCount } from "./cache";
import { prepareQuery, type LlmCallFn, type PreparedQuery } from "./query-prep";
import { noopRerank, type RerankFn } from "./rerank";
import { withMnemoTx, type Tx } from "../tx";
import { MAX_MEMORY_STRENGTH } from "../primitives/fact";
import type { FactKind, FactScope, FactStatus, MemoryType, MnemoFact } from "../primitives/fact";
import { extractPointerTerms, lookupPointer } from "../index/pointer";
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
   * v1.1 #8 — per-entity diversity cap. When `true` (default), no
   * single entity can occupy more than `max(2, ceil(maxResults × 0.15))`
   * slots in the result set. For the default `maxResults=3` the cap is 2
   * (at most 2 hits per entity); for maxResults=20 it's 3. Facts with
   * `entity_id = null` are unaffiliated and never capped.
   *
   * Set to `false` to disable entirely (e.g. when a caller intentionally
   * wants a deep dive into a single entity). Pass a positive integer to
   * set an absolute cap instead of the formula-derived one — useful for
   * tightly bounded budgets that need deterministic limits.
   *
   * The cap is applied AFTER cosine-based near-duplicate pruning and
   * BEFORE graph expansion so the graph hop stage can still pull in
   * neighbors from a capped entity (scored from a reduced-strength
   * parent, so they compete fairly against other direct hits).
   */
  entityDiversityCap?: boolean | number;
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
   *
   * v1.1 #11 — heuristic-provenance edges (system-synthesized via
   * alias merge / coreference / deterministic dedup, stored as
   * `mnemo_relation.provenance = 'heuristic'`) get a SMALLER decay
   * than LLM-derived edges: `min(expandDecay, 0.5)`. They're useful
   * but less trustworthy than an LLM-attested edge, so their
   * neighbors compete from a weaker score floor.
   */
  expandGraph?: boolean;
  /**
   * v1.4 — multiplicative decay applied to a neighbor's score before it
   * competes with the direct hits. Default 0.7. Bounded at [0, 1].
   * `expandGraph` must also be true for this to take effect.
   *
   * v1.1 #11 — this is the BASE decay for LLM-derived edges (the
   * common case). Heuristic-provenance edges use `min(this, 0.5)`
   * regardless of what's passed here. Pass a value <= 0.5 to force
   * a uniform decay across both provenance buckets.
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
   * v1.1 #1+2 — pointer index + drawer-grep. When enabled (default),
   * the pipeline tokenizes the query, looks up the pointer index to
   * find the top-5 most relevant entity drawers, and runs a targeted
   * FTS search restricted to those entities (drawer-grep). The drawer
   * results are merged with the full first-stage results before the
   * reranker; facts in relevant drawers get higher effective coverage.
   *
   * Set to `false` to disable (e.g. for generic cross-entity queries
   * where pointer routing would bias against unlinked facts, or for
   * debugging the base pipeline).
   *
   * The feature degrades gracefully: if the pointer index has no
   * entries for the workspace (new workspace, no entity-linked facts),
   * the drawer-grep is skipped and the pipeline is identical to the
   * pre-v1.1 behaviour.
   */
  usePointerIndex?: boolean;
  /**
   * v1.1 #1+2 — maximum number of entity drawers to route to.
   * Default 5. Values > 5 reduce precision without improving recall.
   * Values < 1 are clamped to 1.
   */
  drawerLimit?: number;
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
  /** v1.1 #8 — entity the fact belongs to, if any (nullable). Used by the
   *  per-entity diversity cap to prevent one entity from dominating the
   *  result set. NULL means the fact is unaffiliated and never capped. */
  entity_id: string | null;
  /** v1.1 #10 — Hebbian trace strength [0.05, 5.0]. Default 1.0 when the
   *  migration hasn't run yet or the fact has never been recalled.
   *  Optional because the hydration query in fetchOneHopNeighbors selects
   *  it explicitly; making it optional lets older driver shims compile
   *  without failing (rowToFact defaults to 1.0). */
  memory_strength?: number;
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
    // v1.1 #8 — entity_id may be NULL for facts not linked to any entity.
    // Defensive default to null for the same reason as memoryType above.
    entityId: r.entity_id ?? null,
    // v1.1 #10 — Hebbian trace strength. Default to 1.0 when the column
    // is absent from the projection (e.g. legacy driver shim) or when the
    // migration hasn't run yet. The SQL DEFAULT is also 1.0, so this is a
    // safe defensive fallback and not a semantic change for existing rows.
    memoryStrength: Number(r.memory_strength ?? 1.0),
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
          entity_id, memory_strength,
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
          entity_id, memory_strength,
          embedding::text AS embedding,
          (1.0 - (embedding <=> ${vecLiteral}::vector)) AS semantic,
          -- v1.1 — #3: also project the BM25 signal so the row mapper
          -- can fuse it with the cosine score without a second round-
          -- trip. ts_rank_cd returns 0 for non-matching rows, which is
          -- the desired fallback (formula degrades to pure semantic
          -- with a 0.3 weight haircut). No FTS match-gate in the WHERE
          -- — otherwise we'd lose all-semantic queries whose lexical
          -- form is foreign to the indexed statements.
          ts_rank_cd(text_lemmatized, plainto_tsquery('simple', ${lexicalQuery})) AS fts_score,
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
    // v1.1 #10 — Hebbian strength signal: normalise [0.05, 5.0] → [0, 1].
    // Adds a +0.05 bonus when strength is at MAX (5.0); contributes 0.01
    // at the DB default (1.0). The bonus is additive on top of the core
    // weighted formula, which theoretically pushes the max from 1.00 to
    // 1.05 — but scores are relative, so the slight inflation only matters
    // for the EARLY_EXIT_THRESHOLD comparison (which is fine: a genuinely
    // strong, oft-recalled fact should bypass reranking).
    const strength = Math.max(
      0,
      Math.min(1, Number(r.memory_strength ?? 1.0) / MAX_MEMORY_STRENGTH)
    );
    // v1.1 — #3: BM25+vector fusion in the vector branch. Mode A keeps
    // its pre-existing pure-FTS formula. ts_rank_cd is unbounded ≥0;
    // clamp at 1 (the FTS-only branch uses the same clamp — see the
    // useFts path right above). For non-matching rows fts=0, so the
    // hybrid collapses to 0.7·semantic — i.e. a 30% haircut vs the
    // pre-v1.1 pure-cosine score, which is the desired bias toward
    // candidates that also fire on the lexical channel.
    const hybrid = 0.7 * semantic + 0.3 * Math.min(1, fts);
    const score = useFts
      ? 0.6 * Math.min(1, fts) + 0.2 * recency + 0.1 * frequency + 0.1 * pin + 0.05 * strength
      : 0.5 * hybrid +
        0.15 * recency +
        0.1 * frequency +
        0.2 * relevance +
        0.05 * pin +
        0.05 * strength;
    return {
      fact: rowToFact(r),
      score,
      // v1.1 — #3: `reasons.semantic` keeps the RAW cosine, not the
      // fused hybrid. Debug callers want to see the underlying signal
      // (e.g. "why did this rank low? — semantic was 0.2") rather than
      // a pre-mixed number that hides the lexical contribution.
      reasons: { semantic, recency, frequency, relevance, pin },
      embedding: parseEmbedding(r.embedding ?? null),
    };
  });

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * v1.1 #1+2 — Drawer-grep: targeted BM25/FTS search restricted to the
 * entity IDs identified by the pointer lookup. Always uses the FTS path
 * (not vector) because the entity filter already narrows the candidate
 * set to a small, high-precision corpus where BM25 precision is
 * adequate and much faster than embedding distance.
 *
 * Shares the same SELECT shape as the FTS branch of runFirstStage so
 * downstream stages (pruning, diversity, graph expansion) see
 * homogeneous ScoredHit rows. Unlike runFirstStage, drawer-grep does
 * NOT require `text_lemmatized @@ query` — we include entity-linked
 * facts that don't match the query text but are in a relevant drawer,
 * letting the score formula naturally sort them below the FTS hits.
 *
 * Callers merge the drawer results with the full first-stage results
 * via `mergeHitPools` before passing to the reranker.
 */
async function runDrawerGrep(
  input: SearchMnemoInput,
  tx: Tx,
  firstStageK: number,
  prepared: PreparedQuery,
  drawerEntityIds: string[]
): Promise<ScoredHit[]> {
  if (drawerEntityIds.length === 0) return [];
  const lexicalQuery = prepared.contextualized;

  // Re-use the existing filter fragments from runFirstStage.
  const asOfFragment = input.asOf
    ? sql`AND valid_from <= ${input.asOf} AND (valid_to IS NULL OR valid_to > ${input.asOf})`
    : sql`AND (valid_to IS NULL OR valid_to > now())`;
  const memoryTypesFragment =
    input.memoryTypes && input.memoryTypes.length > 0
      ? sql`AND memory_type = ANY(${sql.param(input.memoryTypes)}::text[])`
      : sql``;
  const actorIdFragment = input.actorId
    ? sql`AND (actor_id = ${input.actorId} OR actor_id IS NULL)`
    : sql``;
  const attributionFragment =
    input.attributionFilter && input.attributionFilter.length > 0
      ? sql`AND attribution = ANY(${sql.param(input.attributionFilter)}::text[])`
      : sql``;

  const result = await tx.execute(sql`
    SELECT
      id, workspace_id, agent_id, scope, scope_ref, kind, subject,
      statement, confidence, pinned, relevance, hit_count,
      last_recalled_at, source_message_ids, attributed_to,
      linked_memory_ids, metadata, status, merged_into_id,
      valid_from, valid_to, created_at, updated_at, memory_type, attribution,
      entity_id, memory_strength,
      NULL::text AS embedding,
      -- FTS score: non-matching rows get 0 (still included from drawer routing).
      ts_rank_cd(text_lemmatized, plainto_tsquery('simple', ${lexicalQuery})) AS fts_score,
      exp(-LN(2.0) * EXTRACT(EPOCH FROM (now() - created_at)) / (30.0 * 86400.0)) AS recency,
      (ln(1.0 + hit_count) / ln(100.0)) AS frequency,
      CASE WHEN pinned THEN 1.0 ELSE 0.0 END AS pin_bonus
    FROM mnemo_fact
    WHERE workspace_id = ${input.workspaceId}
      AND status       = 'active'
      AND entity_id    = ANY(${sql.param(drawerEntityIds)}::text[])
      ${asOfFragment}
      ${memoryTypesFragment}
      ${actorIdFragment}
      ${attributionFragment}
      ${input.agentId ? sql`AND (agent_id = ${input.agentId} OR agent_id IS NULL)` : sql``}
      ${input.scope ? sql`AND scope = ${input.scope}` : sql``}
      ${input.scopeRef ? sql`AND scope_ref = ${input.scopeRef}` : sql``}
    ORDER BY fts_score DESC, entity_id ASC
    LIMIT ${firstStageK}
  `);

  const rows = result as unknown as FactRow[];
  const scored: ScoredHit[] = rows.map((r) => {
    const fts = Number(r.fts_score ?? 0);
    const recency = Number(r.recency);
    const frequency = Number(r.frequency);
    const pin = Number(r.pin_bonus);
    const strength = Math.max(
      0,
      Math.min(1, Number(r.memory_strength ?? 1.0) / MAX_MEMORY_STRENGTH)
    );
    // Drawer-grep uses the FTS scoring formula (Mode A) regardless of whether
    // the caller has embeddings — the entity filter substitutes for the
    // semantic routing that vector distance provides in Mode B/C.
    const score =
      0.6 * Math.min(1, fts) + 0.2 * recency + 0.1 * frequency + 0.1 * pin + 0.05 * strength;
    return {
      fact: rowToFact(r),
      score,
      reasons: { semantic: 0, recency, frequency, relevance: Number(r.relevance), pin },
      embedding: null, // drawer-grep never needs embeddings for downstream pruning
    };
  });
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * v1.1 #1+2 — Merge two ScoredHit pools into one, deduplicating by
 * fact ID and keeping the higher score for facts that appear in both.
 * The merged result is sorted descending by score.
 *
 * Caller precedence: `primary` facts score wins over `secondary` for
 * equal-score ties (maintains stable ordering from the primary pool).
 */
function mergeHitPools(primary: ScoredHit[], secondary: ScoredHit[]): ScoredHit[] {
  const merged = new Map<string, ScoredHit>();
  for (const h of primary) {
    merged.set(h.fact.id, h);
  }
  for (const h of secondary) {
    const existing = merged.get(h.fact.id);
    if (!existing || h.score > existing.score) {
      merged.set(h.fact.id, h);
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.score - a.score);
}

/**
 * v1.1 — #4: a query is "single-term" when, after splitting on
 * whitespace, exactly ONE token has more than 2 characters. Stopword-
 * sized noise (`a`, `to`, `is`) doesn't count toward the term budget,
 * so `"is auth ok"` collapses to two content words (`auth`, `ok`) and
 * is NOT dampened, while `"auth"` alone is. A query with zero content
 * words (`"x"`, `"   "`, `"a b"`) is NOT single-term either — we can't
 * meaningfully claim "this is a single concept" with no content tokens,
 * so we leave the scores untouched rather than surprise the caller.
 *
 * Exposed for unit-test ergonomics; the dampener itself lives inline
 * in `runSearchPipeline` so it stays close to the score it mutates.
 */
export function isSingleTermQuery(query: string): boolean {
  const contentWords = query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return contentWords.length === 1;
}

/**
 * v1.1 #8 — formula-derived per-entity diversity cap.
 *
 * Pure function so it can be unit-tested without a DB. The pipeline
 * calls this when `entityDiversityCap` is unset (default on) or true;
 * callers that pass an explicit positive integer bypass this formula.
 *
 *   maxResults=1-13 → 2  (floor ensures at least 2 slots per entity)
 *   maxResults=14   → 3  (ceil(14 × 0.15) = ceil(2.1) = 3)
 *   maxResults=20   → 3  (ceil(20 × 0.15) = ceil(3.0) = 3)
 *
 * The 0.15 coefficient was chosen so a single entity can hold at most
 * ~15 % of a standard budget — enough to surface its most relevant
 * facets without crowding out other topics.
 */
export function computeEntityDiversityCap(maxResults: number): number {
  return Math.max(2, Math.ceil(maxResults * 0.15));
}

/**
 * v1.1 #25 — adaptive recall budget. Map the caller's `requested` cap
 * down to a per-tenant tier based on `factCount`. Pure function so it
 * can be unit-tested without a DB.
 *
 * Tiers (from the v1.1 roadmap — char-budget targets in parentheses):
 *   <     1k facts → min(requested,  8)   (~ 8k chars)
 *   <    10k facts → min(requested, 12)   (~16k chars)
 *   <   100k facts → min(requested, 18)   (~28k chars)
 *   else          → min(requested, 20)   (~40k chars)
 *
 * `factCount = Infinity` is the documented escape hatch for count
 * failures (see `getCachedFactCount`) — falls through to the static
 * cap of 20 so a flaky count never silently downgrades a large
 * tenant's recall budget.
 */
export function tieredCap(requested: number, factCount: number): number {
  // Boundary semantics: each tier's predicate is strict-less-than the
  // upper bound, so 1000 facts is "second tier", 10_000 is "third",
  // etc. — matches the roadmap's `< 1,000` / `< 10,000` wording.
  let ceiling: number;
  if (factCount < 1_000) ceiling = 8;
  else if (factCount < 10_000) ceiling = 12;
  else if (factCount < 100_000) ceiling = 18;
  else ceiling = 20;
  return Math.min(requested, ceiling);
}

// ─── Pipeline constants ───────────────────────────────────────────────────────

/** v1.1 #4 — single-term score dampener multiplier. Applied to all first-stage
 *  scores when the user query has exactly one content word (> 2 chars).
 *  Chosen as the midpoint between "ignore" (1.0) and "halve" (0.5): enough
 *  to push generic single-term hits below the rerank early-exit cutoff while
 *  still letting a truly strong single-term match survive the prune threshold. */
const SINGLE_TERM_DAMPENER = 0.6;

/** v1.1 #7 — minimum first-stage top score that bypasses the cross-encoder
 *  reranker. When the post-dampener top hit is >= this threshold the reranker
 *  is unlikely to reorder it, so we skip the latency (Cohere round-trip).
 *  Tightening to 0.95 left too much rerank latency on strong queries;
 *  loosening to 0.85 fired the exit on borderline hits the reranker improves. */
const EARLY_EXIT_THRESHOLD = 0.92;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the full v1.1 pipeline inside a transaction: first-stage retrieval
 * → cross-encoder rerank → post-recall pruning → hard cap.
 */
async function runSearchPipeline(
  input: SearchMnemoInput,
  tx: Tx,
  prepared: PreparedQuery,
  requestedMax: number
): Promise<RecallHit[]> {
  // v1.1 #25 — adapt the caller's requested cap down to the per-
  // tenant tier BEFORE first-stage / rerank / prune run, so the over-
  // fetch budgets below scale with the actual cap. The count read
  // shares this tx (Pattern A RLS gates it on the workspace GUC); a
  // failure inside `getCachedFactCount` returns +Infinity so we fall
  // back to the static cap of 20 without surfacing the error.
  const factCount = await getCachedFactCount(input.workspaceId, tx);
  const maxResults = tieredCap(requestedMax, factCount);

  // Over-fetch so the rerank+prune stages have headroom (5x the final
  // cap, floor 15 — empirically the elbow where deeper search stops
  // adding precision for our `mnemo_fact` cardinality).
  const firstStageK = Math.max(15, maxResults * 5);

  // v1.1 #1+2 — pointer index + drawer-grep tier.
  // Tokenize the query, look up the pointer index to find the most
  // relevant entity drawers, then run a targeted FTS search (drawer-
  // grep) restricted to those entities. Merge the drawer results with
  // the full first-stage results so the reranker sees the best of both.
  //
  // This pre-retrieval routing step is the key to the 96.6% R@5
  // improvement: entity-filtered search has dramatically higher
  // precision for entity-specific queries while the full first-stage
  // covers unlinked/cross-entity facts as before. When the pointer
  // index is empty (new workspace) the merger is a no-op and the
  // pipeline is identical to the pre-v1.1 behaviour.
  let firstStage: ScoredHit[] = [];
  if (input.usePointerIndex !== false) {
    const queryTerms = extractPointerTerms(prepared.contextualized);
    if (queryTerms.length > 0) {
      const drawerLimit = Math.min(Math.max(input.drawerLimit ?? 5, 1), 20);
      const pointerHits = await lookupPointer({
        workspaceId: input.workspaceId,
        queryTerms,
        limit: drawerLimit,
        tx,
      });
      if (pointerHits.length > 0) {
        const drawerEntityIds = pointerHits.map((h) => h.entityId);
        const [fullResults, drawerResults] = await Promise.all([
          runFirstStage(input, tx, firstStageK, prepared),
          runDrawerGrep(input, tx, firstStageK, prepared, drawerEntityIds),
        ]);
        firstStage = mergeHitPools(fullResults, drawerResults);
      } else {
        firstStage = await runFirstStage(input, tx, firstStageK, prepared);
      }
    } else {
      firstStage = await runFirstStage(input, tx, firstStageK, prepared);
    }
  } else {
    firstStage = await runFirstStage(input, tx, firstStageK, prepared);
  }

  // v1.1 — #4: dampen scores for single-term queries (`"auth"`, `"user"`)
  // by 0.6x. Generic single words match almost every fact in a workspace,
  // so the FTS/cosine signal is noisy — downgrading confidence here lets
  // downstream consumers (e.g. #7's rerank early-exit, the prune
  // threshold) see appropriately weak scores. We read `input.query` (the
  // raw user turn) NOT `prepared.contextualized` because the dampener
  // expresses a property of WHAT THE USER ACTUALLY ASKED, not the
  // potentially expanded form.
  if (isSingleTermQuery(input.query)) {
    for (const h of firstStage) h.score *= SINGLE_TERM_DAMPENER;
  }

  // Hybrid-score sort so the reranker sees the strongest candidates first.
  firstStage.sort((a, b) => b.score - a.score);

  // Rerank pass. Budget = 2x final cap so the pruner has duplicates to
  // filter; the safe identity default just truncates to that budget.
  // v1.1 — #7: when the top first-stage hit is already strongly
  // confident (>= 0.92, post-dampener), skip the external reranker —
  // it's unlikely to change the order and adds latency (Cohere is a
  // network round-trip, even noopRerank does work). Reads the post-
  // dampener top so a #4-dampened single-term query never sneaks past
  // this guard on a >= 0.92 RAW score.
  // 0.92 picked as the high-confidence elbow: empirically the score
  // band where the reranker rarely reorders the top hit. Tightening to
  // 0.95 left too much rerank latency on already-strong queries;
  // loosening to 0.85 fired the early-exit on borderline hits whose
  // ordering the reranker would have improved.
  const topScore = firstStage[0]?.score ?? 0;
  const rerankFn = topScore >= EARLY_EXIT_THRESHOLD ? noopRerank : (input.rerank ?? noopRerank);
  const rerankK = maxResults * 2;
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
  // (no embedding → can't measure).
  //
  // We prune up to `rerankK` (the reranker's budget) rather than
  // hard-capping at `maxResults` here — the diversity stage (v1.1 #8)
  // needs the full reranker pool to fill gaps left by capped entities.
  // The final hard cap to `maxResults` is applied after diversity.
  const threshold = input.pruneRedundantThreshold ?? 0.88;
  const pruned = prunePostRecall(postRerank, threshold, rerankK);

  // v1.1 #8 — per-entity diversity cap. Prevents one entity from
  // flooding the budget when many of its facts scored highly (e.g. a
  // workspace with hundreds of facts about one topic).
  //
  // Default: enabled with the formula-derived cap (max(2, ceil(maxResults × 0.15))).
  //   maxResults=3  → cap=2 (at most 2 hits from the same entity)
  //   maxResults=10 → cap=2
  //   maxResults=20 → cap=3
  //
  // Callers can pass `entityDiversityCap: false` to disable, or a
  // positive integer to override the formula with an absolute cap.
  // Applied AFTER cosine-prune so near-duplicates don't consume entity
  // slots unnecessarily. The final hard cap to `maxResults` runs
  // immediately after so the expanded pool is still bounded correctly.
  let postDiversity: ScoredHit[] = pruned;
  const edcOption = input.entityDiversityCap;
  if (edcOption !== false) {
    const formulaCap = computeEntityDiversityCap(maxResults);
    const cap = typeof edcOption === "number" && edcOption > 0 ? edcOption : formulaCap;
    postDiversity = diversifyByEntity(pruned, cap);
  }
  // Hard-cap to maxResults after diversity so the graph-expansion stage
  // gets the correct parent set size regardless of entity filtering.
  postDiversity = postDiversity.slice(0, maxResults);

  // v1.4 — opt-in 1-hop graph expansion. Pruned (and capped) hits act
  // as the parent set. We over-fetch neighbors (decay-discounted) and
  // re-apply the hard cap so a stronger neighbor can crowd out a
  // weaker direct hit. Bounded at 10 neighbors per parent to keep the
  // tail tractable; the cap re-applies at the end so the user-facing
  // result count never exceeds `maxResults`.
  let expanded: ScoredHit[] = postDiversity;
  if (input.expandGraph && postDiversity.length > 0) {
    const decay = clamp01ish(input.expandDecay ?? 0.7);
    const neighbors = await fetchOneHopNeighbors(postDiversity, input.workspaceId, tx, decay);
    if (neighbors.length > 0) {
      // Dedup neighbors against the parents AND against each other —
      // the same fact may be reachable from two parents; keep the
      // higher-scored one (we iterated parents by score, so first-wins
      // already biases toward stronger parents).
      const seenIds = new Set(postDiversity.map((h) => h.fact.id));
      const dedupedNeighbors: ScoredHit[] = [];
      for (const n of neighbors) {
        if (seenIds.has(n.fact.id)) continue;
        seenIds.add(n.fact.id);
        dedupedNeighbors.push(n);
      }
      // Concat + sort by score so neighbors can promote past direct
      // hits when their parent was very high.
      const combined = [...postDiversity, ...dedupedNeighbors];
      combined.sort((a, b) => b.score - a.score);
      // Re-apply the entity diversity cap so graph neighbors can't
      // flood the result set for an already-capped entity. The cap
      // runs on the full combined pool (parents already count toward
      // each entity's slot tally), then the hard maxResults slice.
      if (edcOption !== false) {
        const formulaCap = computeEntityDiversityCap(maxResults);
        const cap = typeof edcOption === "number" && edcOption > 0 ? edcOption : formulaCap;
        expanded = diversifyByEntity(combined, cap).slice(0, maxResults);
      } else {
        expanded = combined.slice(0, maxResults);
      }
    }
  }

  // Strip the internal `embedding` field — it's never part of the
  // public RecallHit contract (the rowToFact mapper already sets
  // `fact.embedding: null` for the same reason).
  return expanded.map(({ embedding: _e, ...hit }) => hit);
}

/**
 * v1.1 #8 — per-entity diversity cap.
 *
 * Walks `hits` in their current order (post-rerank, post-cosine-prune)
 * and drops any fact that would make a single entity exceed `cap` slots.
 * Facts with `entity_id = null` are unaffiliated and always kept.
 *
 * The hard result cap (`maxResults`) is NOT re-applied here — the caller
 * is responsible for that. We only enforce the per-entity limit so the
 * caller's subsequent pruning / graph-expansion can work with the full
 * budget.
 *
 * @param hits  Post-prune hits in descending-score order.
 * @param cap   Max hits allowed per non-null entity_id (>= 1).
 */
function diversifyByEntity(hits: ScoredHit[], cap: number): ScoredHit[] {
  // Guarantee cap >= 1 — a cap of 0 would drop every entity-affiliated
  // fact, which is almost certainly a misconfiguration.
  const safeCap = Math.max(1, cap);
  const entitySlots = new Map<string, number>();
  const out: ScoredHit[] = [];
  for (const h of hits) {
    const eid = h.fact.entityId ?? null;
    if (eid === null) {
      out.push(h);
      continue;
    }
    const used = entitySlots.get(eid) ?? 0;
    if (used >= safeCap) continue; // entity slot exhausted — skip
    entitySlots.set(eid, used + 1);
    out.push(h);
  }
  return out;
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
  /** v1.1 #11 — NULL ⇒ LLM-derived; 'heuristic' ⇒ system-synthesized
   *  (alias merge / coreference / deterministic dedup). Drives the
   *  per-edge decay in `decayForEdge`. */
  provenance: string | null;
}

/**
 * v1.1 #11 — per-edge decay. Heuristic-provenance edges are less
 * trustworthy than LLM-attested ones, so their neighbors compete from
 * a weaker score floor (cap at 0.5). LLM edges (provenance NULL) use
 * the caller's base decay unchanged.
 *
 * The caller-supplied `base` is treated as the LLM-edge decay; heuristic
 * edges use `min(base, 0.5)` so a stricter base (e.g. 0.3) still wins.
 */
function decayForEdge(base: number, provenance: string | null): number {
  return provenance === "heuristic" ? Math.min(base, 0.5) : base;
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
    SELECT source_id AS src_id, target_id AS dst_id, relation AS verb,
           provenance
    FROM mnemo_relation
    WHERE workspace_id = ${workspaceId}
      AND source_kind = 'fact'
      AND target_kind = 'fact'
      AND source_id = ANY(${sql.param(parentIds)}::text[])
      AND relation = ANY(${sql.param(verbList)}::text[])
  `);
  const edges = edgeResult as unknown as RelationEdgeRow[];
  if (edges.length === 0) return [];

  // Map parent.id → first MAX_NEIGHBORS_PER_PARENT neighbor edges. We
  // walk edges in arrival order, so a hub fact's tail just gets
  // truncated rather than dropping signal randomly. We track the full
  // edge (not just dst_id) so the assembly loop can apply per-edge
  // decay based on `provenance` (v1.1 #11).
  const edgesByParent = new Map<string, RelationEdgeRow[]>();
  for (const e of edges) {
    let arr = edgesByParent.get(e.src_id);
    if (!arr) {
      arr = [];
      edgesByParent.set(e.src_id, arr);
    }
    if (arr.length < MAX_NEIGHBORS_PER_PARENT) arr.push(e);
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
      entity_id, memory_strength,
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
  //
  // v1.1 #11 — per-edge decay via `decayForEdge(decay, edge.provenance)`:
  // heuristic-provenance edges cap at 0.5 regardless of the caller's
  // base. TODO(v1.2): first-wins ignores provenance — a neighbor
  // reachable from p1 via a heuristic edge AND p2 via an LLM edge
  // currently keeps the p1 attribution (and the heuristic decay) just
  // because p1 had the higher parent score. Ideally we'd prefer the
  // LLM-attested edge for the same neighbor, but that's a larger
  // change (the dedup needs to weigh edge quality vs parent score).
  const out: ScoredHit[] = [];
  const seenNeighbors = new Set<string>();
  for (const parent of parents) {
    const parentEdges = edgesByParent.get(parent.fact.id);
    if (!parentEdges) continue;
    for (const edge of parentEdges) {
      if (seenNeighbors.has(edge.dst_id)) continue;
      const row = factById.get(edge.dst_id);
      if (!row) continue; // hydration dropped it (RLS / status mismatch).
      seenNeighbors.add(edge.dst_id);
      const edgeDecay = decayForEdge(decay, edge.provenance);
      out.push({
        fact: rowToFact(row),
        score: parent.score * edgeDecay,
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

  // v1.6 G1-4: L3 query cache. Only consult when (a) we have an
  // embedding provider — Mode A FTS-only has no query vector — AND
  // (b) we're NOT in time-travel mode — historical snapshots must
  // not be cached as "current" recall and risk leaking stale state.
  const useL3 =
    !input.asOf && !!input.embeddingProvider && !!input.embeddingModel && !!input.embedFn;
  let queryVecForL3: number[] | null = null;
  if (useL3) {
    try {
      // Run inside a tx so RLS sees `app.workspace_id`. Honor caller-
      // owned tx when present.
      const computeAndLookup = async (tx: Tx): Promise<RecallHit[] | null> => {
        // Re-use the same embedding query the first-stage uses so the
        // vector matches what would have been computed downstream.
        const embeddingQuery = prepared.hypothetical ?? prepared.contextualized;
        const vecs = await embedMnemo({
          workspaceId: input.workspaceId,
          texts: [embeddingQuery],
          provider: input.embeddingProvider!,
          model: input.embeddingModel!,
          embedFn: input.embedFn!,
          tx: tx as never,
        });
        const vec = vecs[0];
        if (!vec || vec.length === 0) return null;
        queryVecForL3 = vec;
        const l3Hit = await getL3Cache(input.workspaceId, vec, tx, {
          scope: input.scope ?? null,
          scopeRef: input.scopeRef ?? null,
          agentId: input.agentId ?? null,
          topK,
        });
        return l3Hit ? l3Hit.hits : null;
      };
      const l3Hits = input.tx
        ? await computeAndLookup(input.tx)
        : await withMnemoTx(input.workspaceId, (tx) => computeAndLookup(tx as Tx));
      if (l3Hits) {
        // Warm the L1 LRU too so repeated identical queries don't re-
        // hit the table.
        recallCache.set(cacheK, l3Hits as unknown as object);
        return l3Hits;
      }
    } catch {
      // L3 lookup must NEVER break recall — fall through to the full
      // pipeline on any error.
    }
  }

  const hits = input.tx
    ? await runSearchPipeline(input, input.tx, prepared, topK)
    : await withMnemoTx(input.workspaceId, (tx) =>
        runSearchPipeline(input, tx as Tx, prepared, topK)
      );

  recallCache.set(cacheK, hits as unknown as object);

  // v1.6 G1-4: write-through into L3. Skip in time-travel mode and
  // when we never computed a query vector (Mode A or embed failure).
  if (useL3 && queryVecForL3) {
    const rowId = `${input.workspaceId}:${queryHash}:${topK}`;
    const writer = async (tx: Tx): Promise<void> => {
      await setL3Cache(input.workspaceId, queryVecForL3!, hits, tx, {
        rowId,
        scope: input.scope ?? null,
        scopeRef: input.scopeRef ?? null,
        agentId: input.agentId ?? null,
        topK,
      });
    };
    try {
      if (input.tx) await writer(input.tx);
      else await withMnemoTx(input.workspaceId, (tx) => writer(tx as Tx));
    } catch {
      // never break recall on cache-write failure
    }
  }
  return hits;
}
