// packages/mnemosyne/src/recall/unified.ts
//
// Mnemosyne v1.4 — Unified recall. One entry point that:
//   1. calls `searchMnemo` for fact memory (RecallHit[]),
//   2. (optionally) calls a host-injected `KbChunkProvider` for KB
//      knowledge chunks (KbChunk[]),
//   3. normalizes the two score scales, blends them with caller-
//      configurable weights, and
//   4. optionally re-ranks the MERGED set with the same `RerankFn`
//      that searchMnemo exposes.
//
// Why this lives in mnemosyne (a memory package) rather than in the
// host: the blending policy IS memory-semantic. Mnemosyne owns the
// "facts are dense conversational signal" weighting heuristic and the
// score normalization. The host stays KB-agnostic — it injects a
// callback that returns chunks scored against the query.
//
// §0.1 (package-cleanliness): no `server-only`, no path aliases to
// the host app. The KB query function is dependency-injected via the
// `KbChunkProvider` interface; mnemosyne does not import any KB code.
//
// Failure semantics:
//  - If the KB provider throws, we degrade to memory-only (a flaky KB
//    must NOT break recall). The host can observe failures via the
//    same `onError` pattern as query-prep — exposed indirectly through
//    a try/catch around the provider call.
//  - If `searchMnemo` throws, we re-throw (memory search failing is a
//    real problem the host needs to handle).
//
// The blended score for hit `h` is:
//   - source === 'memory': `unifiedScore = memoryWeight * h.score`
//   - source === 'kb':     `unifiedScore = kbWeight    * (h.score / maxKbScore)`
// The KB normalization uses the max raw KB score in the response to
// map onto [0, 1]; if there are no KB hits the normalization is a
// no-op. Memory scores already live in [0, 1] (searchMnemo's hybrid
// blend), so no normalization there.

import { searchMnemo, type RecallHit, type SearchMnemoInput } from "./search";
import { noopRerank, type RerankFn } from "./rerank";
import type { LlmCallFn } from "./query-prep";
import type { Tx } from "../tx";

export type UnifiedRecallSource = "memory" | "kb";

/**
 * Source information for a KB chunk. `docId` + `docTitle` are required
 * (the agent runtime needs them for citation rendering); `page` is
 * optional (PDFs / paginated docs only).
 */
export interface KbChunkSource {
  docId: string;
  docTitle: string;
  page?: number | undefined;
}

export interface KbChunk {
  id: string;
  content: string;
  /** Raw provider score — interpretation is opaque to mnemosyne. We
   *  normalize against `max(score)` in the response to map onto [0,1]. */
  score: number;
  source: KbChunkSource;
}

/**
 * Host-provided KB search callback. Mnemosyne stays KB-agnostic; the
 * host wires this against its existing `knowledge_chunk` query path.
 *
 * Implementations MUST:
 *  - Honor the `workspaceId` (RLS gate),
 *  - Return at most `topK` hits, sorted desc by score.
 *
 * Implementations SHOULD swallow no-results into `[]` rather than
 * throwing — the merge layer handles the empty case cleanly.
 */
export interface KbChunkProvider {
  search(input: { workspaceId: string; query: string; topK: number }): Promise<KbChunk[]>;
}

export interface UnifiedRecallHit {
  source: UnifiedRecallSource;
  id: string;
  /** Fact statement OR KB chunk text. Truncated by the host adapter. */
  content: string;
  /** Blended score in [0, 1] — comparable across sources. */
  score: number;
  /**
   * Free-form metadata. For `memory`: `{ kind, subject, pinned,
   * memoryType, reasons }`. For `kb`: `{ docId, docTitle, page? }`.
   */
  metadata: Record<string, unknown>;
}

export interface RecallUnifiedInput {
  workspaceId: string;
  query: string;
  agentId?: string;
  /**
   * Memory weight in the blended score. Default 0.6 — facts are more
   * signal-dense for conversational context (the user's own
   * statements, learned preferences) than KB pages.
   */
  memoryWeight?: number;
  /** KB weight in the blended score. Default 0.4. */
  kbWeight?: number;
  /**
   * Final cap on the merged + reranked result set. Default 5
   * (intentionally higher than searchMnemo's default 3 — the merged
   * set covers two source types and the caller usually wants headroom
   * for both). Bounded at [1, 20].
   */
  topK?: number;
  /**
   * Host-injected KB provider. When absent the call falls back to
   * memory-only — the caller still gets a uniformly-typed array
   * (`UnifiedRecallHit[]` with `source: 'memory'`) so downstream code
   * doesn't branch.
   */
  kbProvider?: KbChunkProvider;
  /**
   * Cross-encoder reranker applied to the merged set (post-blend).
   * If absent, the merged set is sorted by `score` desc and capped.
   * See `./rerank.ts`.
   */
  rerank?: RerankFn;
  // ── Pass-through options to searchMnemo ────────────────────────────
  enableHyDE?: boolean;
  enableContextualize?: boolean;
  prepareQueryLlm?: LlmCallFn;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  actorId?: string;
  /**
   * v1.6 — forward to searchMnemo so the memory leg can 1-hop expand
   * via the `derived_from` / `supersedes` / `part_of` / `member_of` /
   * `scoped` / `related` edges. KB hits are not expanded (kbProvider
   * is content-only). When omitted, searchMnemo's own default applies
   * (currently OFF at the package layer; the agent runtime flips it
   * ON via this passthrough as part of the v1.6 defaults).
   */
  expandGraph?: boolean;
  /** Optional transaction. Forwarded to searchMnemo. */
  tx?: Tx;
}

const DEFAULT_MEMORY_WEIGHT = 0.6;
const DEFAULT_KB_WEIGHT = 0.4;
const DEFAULT_TOPK = 5;

/**
 * Unified recall: memory + KB → blended → reranked → top-K.
 *
 * The two searches run in parallel — KB latency tends to dominate
 * (network for embeddings, then a vector scan), and memory latency is
 * dominated by the host LLM round-trip for HyDE. Running them in
 * series would add ~600ms; in parallel we pay max(both).
 */
export async function recallUnified(input: RecallUnifiedInput): Promise<UnifiedRecallHit[]> {
  const memoryWeight = clampWeight(input.memoryWeight ?? DEFAULT_MEMORY_WEIGHT);
  const kbWeight = clampWeight(input.kbWeight ?? DEFAULT_KB_WEIGHT);
  const topK = Math.min(Math.max(input.topK ?? DEFAULT_TOPK, 1), 20);

  // Over-fetch each source so the merged set has headroom for the
  // post-merge rerank+cap (mirrors searchMnemo's first-stage strategy).
  const perSourceK = Math.max(topK * 2, topK);

  // ── Build the searchMnemo input (forward all pass-through opts) ──
  const searchInput: SearchMnemoInput = {
    workspaceId: input.workspaceId,
    query: input.query,
    maxResults: perSourceK,
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
    ...(input.enableHyDE !== undefined ? { enableHyDE: input.enableHyDE } : {}),
    ...(input.enableContextualize !== undefined
      ? { enableContextualize: input.enableContextualize }
      : {}),
    ...(input.prepareQueryLlm !== undefined ? { prepareQueryLlm: input.prepareQueryLlm } : {}),
    ...(input.history !== undefined ? { history: input.history } : {}),
    // v1.6 — passthrough so the recall pipeline can 1-hop expand
    // when the host (agent-runtime) enables it.
    ...(input.expandGraph !== undefined ? { expandGraph: input.expandGraph } : {}),
    ...(input.tx !== undefined ? { tx: input.tx } : {}),
  };

  // ── Parallel fan-out ──────────────────────────────────────────────
  // Memory search bubbles errors (recall failure IS a real problem the
  // caller needs to see). KB search is degraded to [] on error — a
  // flaky KB must never crash a recall pipeline.
  const kbProvider = input.kbProvider;
  const [memoryHits, kbHits] = await Promise.all([
    searchMnemo(searchInput),
    kbProvider
      ? kbProvider
          .search({
            workspaceId: input.workspaceId,
            query: input.query,
            topK: perSourceK,
          })
          .catch(() => [] as KbChunk[])
      : Promise.resolve([] as KbChunk[]),
  ]);

  // ── Normalize + blend ─────────────────────────────────────────────
  // Memory scores live in [0, 1] already (searchMnemo's hybrid
  // formula). KB scores are provider-opaque — we normalize against the
  // max in the response. Empty KB → skip normalization.
  const maxKbScore = kbHits.length > 0 ? Math.max(...kbHits.map((h) => h.score)) : 1;
  const kbDivisor = maxKbScore > 0 ? maxKbScore : 1;

  const memoryUnified: UnifiedRecallHit[] = memoryHits.map((h) => ({
    source: "memory" as const,
    id: h.fact.id,
    content: h.fact.statement,
    score: memoryWeight * h.score,
    metadata: {
      kind: h.fact.kind,
      subject: h.fact.subject,
      pinned: h.fact.pinned,
      memoryType: h.fact.memoryType,
      reasons: h.reasons,
    },
  }));

  const kbUnified: UnifiedRecallHit[] = kbHits.map((h) => ({
    source: "kb" as const,
    id: h.id,
    content: h.content,
    score: kbWeight * (h.score / kbDivisor),
    metadata: {
      docId: h.source.docId,
      docTitle: h.source.docTitle,
      ...(h.source.page !== undefined ? { page: h.source.page } : {}),
    },
  }));

  const merged = [...memoryUnified, ...kbUnified];

  // ── Optional cross-encoder rerank over the merged set ────────────
  // The reranker sees both fact statements and KB chunks; it doesn't
  // need to know the source — the (query, document) joint scoring is
  // source-agnostic. We feed it the contents in their current sort
  // order so a misbehaving reranker can't make things worse than the
  // already-blended ordering.
  if (merged.length === 0) return [];
  merged.sort((a, b) => b.score - a.score);

  const rerankFn = input.rerank ?? noopRerank;
  const rerankBudget = Math.min(merged.length, topK * 2);
  const rerankIndices = await rerankFn({
    query: input.query,
    documents: merged.map((h) => h.content),
    topK: rerankBudget,
  });

  const reranked: UnifiedRecallHit[] = [];
  const seen = new Set<number>();
  for (const i of rerankIndices) {
    if (seen.has(i)) continue;
    seen.add(i);
    const hit = merged[i];
    if (hit) reranked.push(hit);
    if (reranked.length >= topK) break;
  }
  // Defensive: misbehaving reranker returns nothing → fall back to the
  // already-blended order. noopRerank cannot hit this path.
  if (reranked.length === 0) return merged.slice(0, topK);
  return reranked;
}

function clampWeight(w: number): number {
  if (!Number.isFinite(w) || w < 0) return 0;
  if (w > 1) return 1;
  return w;
}
