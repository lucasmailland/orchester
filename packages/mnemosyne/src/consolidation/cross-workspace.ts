// packages/mnemosyne/src/consolidation/cross-workspace.ts
//
// v2 — Cross-workspace consolidation: pure clustering algorithm.
//
// SCOPE OF THIS MODULE:
//   This file contains ONLY the deterministic pure-function algorithm
//   that takes a flat list of fact references with embeddings and
//   groups them into multi-workspace clusters suitable for the
//   org-level consolidation surface (`mnemo_org_fact_view`, designed
//   in docs/specs/2026-05-30-cross-workspace-consolidation-design.md).
//
//   It does NOT:
//     - read or write any database table,
//     - issue any LLM call,
//     - apply RLS / role downgrade,
//     - perform PII redaction (the cron does that BEFORE LLM summary).
//
// WHY THIS LANDS WITHOUT THE MIGRATION:
//   The cron (Phase 4 in the design doc) is gated on legal + security
//   signoff per §6 of the spec. Until that signoff, no production code
//   path consumes this module. Shipping the pure algorithm now means:
//     (1) the clustering logic is reviewable in isolation,
//     (2) when the cron lands, it's a thin orchestrator over a
//         well-tested core,
//     (3) tests can run against synthetic embeddings with zero
//         infrastructure.
//
// ALGORITHM:
//   1. Group inputs by (subject, kind). Same subject+kind across
//      workspaces is the necessary precondition for a meaningful
//      cluster — different subjects compute different cosine spaces.
//   2. Within each group, union-find by cosine ≥ similarityThreshold.
//   3. Discard single-element clusters AND single-workspace clusters
//      (the per-workspace consolidation already covers those).
//   4. Return clusters with the contributing workspace + fact IDs and
//      the cluster's mean intra-cluster cosine (the "cluster strength"
//      surfaced in the admin UI per §5.1 of the spec).
//
// COMPLEXITY:
//   O(n²) per (subject, kind) group due to pairwise cosine. The cron
//   (when it lands) is expected to chunk inputs per-org-per-day to keep
//   each call tractable; the algorithm itself does NOT page — that's
//   the caller's responsibility, documented on `clusterCrossWorkspace`.
//
// SECURITY CALL-OUT (repeated from the spec):
//   The cron MUST call this with embedding + minimal metadata ONLY.
//   It MUST NOT pass the full statement text. Only after a cluster is
//   identified does the cron fetch full statements for the cluster
//   members, redact PII, and send to the LLM summary call. This module
//   accepts `statement?: string` for tests and future flexibility, but
//   the production cron MUST omit it (see `CrossWorkspaceFactInput`).

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CrossWorkspaceFactInput {
  /** mnemo_fact.id */
  factId: string;
  /** Owning workspace id. */
  workspaceId: string;
  /** Subject of the fact (e.g. "user", "project:pixel"). */
  subject: string;
  /** Fact kind (e.g. "preference", "trait"). */
  kind: string;
  /** Dense embedding. MUST be the same model/dimension across inputs. */
  embedding: number[];
  /**
   * Statement text. STRONGLY DISCOURAGED in production cross-workspace
   * calls (see SECURITY CALL-OUT). Optional only for test fixtures.
   */
  statement?: string;
}

export interface CrossWorkspaceCluster {
  /** Subject + kind shared by every member. */
  subject: string;
  kind: string;
  /** Cluster members in input order. */
  facts: CrossWorkspaceFactInput[];
  /** Unique workspace ids represented in the cluster (sorted). */
  workspaceIds: string[];
  /**
   * Mean pairwise cosine across all (i, j) pairs in the cluster
   * (i < j). Surfaced in the org-admin UI as the "cluster strength"
   * bar — higher is tighter. Range [0, 1].
   */
  meanSimilarity: number;
}

export interface ClusterCrossWorkspaceInput {
  facts: CrossWorkspaceFactInput[];
  /** Minimum cosine to merge two facts. Spec §4.1 baseline 0.85. */
  similarityThreshold?: number;
  /**
   * Minimum number of facts in a kept cluster. Default 2 — a singleton
   * isn't a "cross-workspace duplicate" by any definition.
   */
  minClusterSize?: number;
  /**
   * Minimum number of distinct workspaces represented in a kept
   * cluster. Default 2 — per-workspace consolidation already covers
   * intra-workspace clusters, so any cluster confined to one workspace
   * is filtered out here.
   */
  minWorkspaceCount?: number;
}

// ── Cosine ────────────────────────────────────────────────────────────────────

/**
 * Standard cosine similarity. Returns 0 for zero-length or mismatched
 * dimensions — defensive defaults that keep the union-find merge safe
 * when an input embedding is malformed. We don't throw because the
 * cron may be reading embeddings from many workspaces over many model
 * versions; a single bad row shouldn't crash the whole batch.
 *
 * Internal — exported only for the test suite to assert the same
 * cosine semantics as `search.ts` (intentional duplication; that
 * module's `cosineSim` is module-private).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
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

// ── Union-find ────────────────────────────────────────────────────────────────

/**
 * Path-compressed union-find over `n` items. Standard textbook impl
 * inlined here so the module stays zero-dependency.
 */
class UnionFind {
  private readonly parent: number[];
  private readonly rank: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root]!;
    // Path compression — point every visited node directly at the root.
    let cur = x;
    while (this.parent[cur] !== root) {
      const next = this.parent[cur]!;
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank[ra]!;
    const rankB = this.rank[rb]!;
    if (rankA < rankB) this.parent[ra] = rb;
    else if (rankA > rankB) this.parent[rb] = ra;
    else {
      this.parent[rb] = ra;
      this.rank[ra] = rankA + 1;
    }
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

const DEFAULT_SIMILARITY_THRESHOLD = 0.85;
const DEFAULT_MIN_CLUSTER_SIZE = 2;
const DEFAULT_MIN_WORKSPACE_COUNT = 2;

/**
 * Cluster a batch of facts cross-workspace.
 *
 * Returns clusters that meet BOTH the size and workspace-distinctness
 * thresholds, sorted by `meanSimilarity` descending (strongest cluster
 * first — the admin UI surfaces these in priority order).
 *
 * Caller responsibilities:
 *   - Pass embeddings from the SAME model + dimension. Cross-model
 *     mixing would produce meaningless cosine values; we don't detect
 *     this, we just compute zero similarity for mismatched dimensions
 *     and the clusters silently fail to form.
 *   - Page large inputs. This function is O(n²) per (subject, kind)
 *     group. For a 100-workspace org with 10k facts each, the cron
 *     should chunk by `(subject, kind)` and incremental
 *     `last_consolidated_at` watermark (see spec §9 "Throttling").
 *
 * Idempotent for a given input — same `facts` array yields the same
 * cluster set (cluster order is deterministic because Map iteration
 * order in JS is insertion order).
 */
export function clusterCrossWorkspace(input: ClusterCrossWorkspaceInput): CrossWorkspaceCluster[] {
  const threshold = input.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const minClusterSize = Math.max(2, input.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE);
  const minWorkspaceCount = Math.max(2, input.minWorkspaceCount ?? DEFAULT_MIN_WORKSPACE_COUNT);

  // ── 1. Group by (subject, kind) ────────────────────────────────────
  // Two facts only cluster if they describe the same subject+kind. A
  // "user preference" fact about Lucas and a "user preference" fact
  // about Daisy don't belong in the same cluster even if their
  // statements happen to cosine-similar.
  const groups = new Map<string, CrossWorkspaceFactInput[]>();
  for (const f of input.facts) {
    const key = `${f.kind}\x00${f.subject}`;
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  const out: CrossWorkspaceCluster[] = [];

  // ── 2-4. Per-group union-find → filter → emit ─────────────────────
  for (const [, members] of groups) {
    if (members.length < 2) continue; // can't form a cluster of 1

    const uf = new UnionFind(members.length);
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const sim = cosineSimilarity(members[i]!.embedding, members[j]!.embedding);
        if (sim >= threshold) uf.union(i, j);
      }
    }

    // Collect components.
    const components = new Map<number, number[]>();
    for (let i = 0; i < members.length; i++) {
      const root = uf.find(i);
      const arr = components.get(root) ?? [];
      arr.push(i);
      components.set(root, arr);
    }

    for (const [, idxs] of components) {
      if (idxs.length < minClusterSize) continue;
      const facts = idxs.map((i) => members[i]!);
      const wsSet = new Set(facts.map((f) => f.workspaceId));
      if (wsSet.size < minWorkspaceCount) continue;

      out.push({
        subject: facts[0]!.subject,
        kind: facts[0]!.kind,
        facts,
        workspaceIds: [...wsSet].sort(),
        meanSimilarity: meanPairwiseSimilarity(facts),
      });
    }
  }

  // Strongest clusters first so the admin UI surfaces them in priority
  // order without an additional sort.
  out.sort((a, b) => b.meanSimilarity - a.meanSimilarity);
  return out;
}

/**
 * Mean pairwise cosine across all (i, j) pairs in `facts` (i < j).
 * Returns 0 for a single-element input (defensive — callers filter
 * before this point, but the check costs nothing).
 *
 * Exported for unit tests + the spec-mandated "cluster strength" bar
 * computation on the org-admin UI.
 */
export function meanPairwiseSimilarity(facts: CrossWorkspaceFactInput[]): number {
  if (facts.length < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      sum += cosineSimilarity(facts[i]!.embedding, facts[j]!.embedding);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}
