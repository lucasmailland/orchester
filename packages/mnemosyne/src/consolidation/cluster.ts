// packages/mnemosyne/src/consolidation/cluster.ts
//
// Mnemosyne v1.4 — REM-style nightly consolidation: clustering phase.
//
// Loose cousin of the janitor's `findDedupCandidates` but with looser
// semantics. Dedup wants "this fact is a NEAR-DUPLICATE — collapse them
// into one"; consolidation wants "these N facts ARE RELATED — write a
// summary that supersedes them, but keep the originals". Hence:
//
//   • dedup cosine threshold:  0.92  (restrictive)
//   • consolidation threshold: 0.75  (loose by default)
//
//   • dedup picks one primary, archives the rest.
//   • consolidation generates a NEW summary fact and stamps the
//     originals with `derived_from` relations pointing at it. The
//     originals stay `status='active'` (still findable) but the
//     consolidated summary is the canonical recall hit.
//
// Same union-find topology as dedup, same `(workspace_id, status,
// embedding IS NOT NULL)` precondition. We additionally constrain a
// cluster by SAME subject AND SAME kind — consolidating across
// different subjects ("user prefers TS" + "deploy prefers Vercel")
// would produce nonsensical summaries.
//
// Pure READ — no writes. `consolidateCluster` (in `./summarize.ts`)
// performs the LLM call + insert + relation creation; this helper just
// returns the clusters. RLS+FORCE Pattern A applies via the supplied
// `tx` already wrapped by `withMnemoTx`.
import { sql } from "drizzle-orm";
import type { Tx } from "../tx";
import type { MnemoFact, FactKind } from "../primitives/fact";
import { UnionFind } from "../janitor/dedup";

/** Default cosine threshold — looser than dedup (0.92) because we
 *  want RELATED facts, not duplicates. Empirically 0.75 catches
 *  facts that share a topic without overlapping verbatim. */
const DEFAULT_MIN_COSINE = 0.75;

/** Minimum cluster size to bother summarising. Below this the
 *  summary would be redundant — 2 related facts already fit in the
 *  prompt window; the LLM round-trip costs more than it saves. */
const DEFAULT_MIN_CLUSTER_SIZE = 4;

/** Hard cap on facts scanned per workspace per run. Mirrors the
 *  dedup limit; workspaces above this become a v1.5 pathological
 *  case (per-subject scan). */
const SCAN_LIMIT = 5000;

/** Hard cap on clusters returned per run. Each cluster triggers an
 *  LLM call downstream, so the cap doubles as a cost ceiling. */
const DEFAULT_MAX_CLUSTERS = 25;

/**
 * One consolidation cluster — N >= `minClusterSize` related facts
 * about the same subject + kind. The downstream `consolidateCluster`
 * LLM call writes a single summary fact + `derived_from` edges to
 * each member.
 */
export interface ConsolidationCluster {
  subject: string;
  kind: FactKind;
  members: MnemoFact[];
  cosineMin: number;
}

export interface FindConsolidationClustersInput {
  workspaceId: string;
  minClusterSize?: number;
  minCosine?: number;
  maxClusters?: number;
  tx: Tx;
}

interface CandidateRow {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  scope: "global" | "conversation" | "employee" | "team";
  scope_ref: string | null;
  kind: FactKind;
  subject: string;
  statement: string;
  confidence: string | number;
  pinned: boolean;
  relevance: string | number;
  hit_count: number;
  last_recalled_at: string | null;
  source_message_ids: string[];
  attributed_to: "user" | "assistant" | "system" | null;
  linked_memory_ids: string[];
  metadata: Record<string, unknown> | string;
  status: "active" | "merged" | "forgotten";
  merged_into_id: string | null;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
  updated_at: string;
}

interface EdgeRow {
  a_id: string;
  b_id: string;
  sim: string | number;
}

/**
 * Walk the workspace's active embedded facts and return clusters of
 * related facts (same subject + kind, cosine >= minCosine) with size
 * >= minClusterSize. Skips facts that already have a `derived_from`
 * edge pointing at a consolidated summary — re-running the cron on
 * a workspace that's already been consolidated picks up only NEW
 * clusters formed since the last pass.
 *
 * Algorithm:
 *   1. SELECT active embedded facts, exclude rows that ALREADY have
 *      a `derived_from` edge written by a prior consolidation run.
 *   2. SELF-JOIN restricted to SAME subject + SAME kind, cosine >=
 *      minCosine. This is more restrictive than dedup (which
 *      ignores subject/kind) — we want semantically tight clusters.
 *   3. Union-find over the edges. Components with size >=
 *      minClusterSize become clusters; the rest are dropped.
 *   4. The minimum-cosine edge inside each component surfaces as
 *      `cosineMin` so a downstream cost-control layer can drop
 *      low-cohesion clusters before paying for the LLM call.
 */
export async function findConsolidationClusters(
  input: FindConsolidationClustersInput
): Promise<ConsolidationCluster[]> {
  const minCosine = input.minCosine ?? DEFAULT_MIN_COSINE;
  const minClusterSize = input.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE;
  const maxClusters = input.maxClusters ?? DEFAULT_MAX_CLUSTERS;
  const maxDistance = 1 - minCosine; // pgvector's <=> is distance, not similarity.

  // ── 1. fetch active embedded facts that are NOT already
  //       consolidated — i.e. there is no outgoing `derived_from`
  //       edge from this fact pointing at a summary fact. We use a
  //       LEFT JOIN to `mnemo_relation` so the absence-of-edge
  //       condition is expressible in one query.
  //
  // Workspace_id is repeated in the WHERE for index selection + as
  // defense-in-depth even though RLS already gates the GUC.
  const factRows = (await input.tx.execute(sql`
    SELECT
      f.id, f.workspace_id, f.agent_id, f.scope, f.scope_ref, f.kind, f.subject,
      f.statement, f.confidence, f.pinned, f.relevance, f.hit_count,
      f.last_recalled_at, f.source_message_ids, f.attributed_to,
      f.linked_memory_ids, f.metadata, f.status, f.merged_into_id,
      f.valid_from, f.valid_to, f.created_at, f.updated_at
    FROM mnemo_fact f
    WHERE f.workspace_id = ${input.workspaceId}
      AND f.status = 'active'
      AND f.embedding IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM mnemo_relation r
        WHERE r.workspace_id = f.workspace_id
          AND r.source_id = f.id
          AND r.source_kind = 'fact'
          AND r.target_kind = 'fact'
          AND r.relation = 'derived_from'
      )
    ORDER BY f.id
    LIMIT ${SCAN_LIMIT}
  `)) as unknown as CandidateRow[];

  if (factRows.length < minClusterSize) return [];

  const factsById = new Map<string, MnemoFact>();
  for (const r of factRows) factsById.set(r.id, rowToFact(r));

  // ── 2. self-join — pgvector cosine + same subject + same kind.
  // `a.id < b.id` makes the upper triangle exactly once. The
  // subject/kind constraints are cheap b-tree filters on the index
  // (workspace_id, status) → planner usually picks them first.
  const edgeRows = (await input.tx.execute(sql`
    SELECT
      a.id AS a_id,
      b.id AS b_id,
      1.0 - (a.embedding <=> b.embedding) AS sim
    FROM mnemo_fact a
    JOIN mnemo_fact b
      ON a.workspace_id = b.workspace_id
     AND a.id < b.id
     AND a.subject = b.subject
     AND a.kind = b.kind
    WHERE a.workspace_id = ${input.workspaceId}
      AND a.status = 'active'
      AND b.status = 'active'
      AND a.embedding IS NOT NULL
      AND b.embedding IS NOT NULL
      AND (a.embedding <=> b.embedding) <= ${maxDistance}
  `)) as unknown as EdgeRow[];

  if (edgeRows.length === 0) return [];

  // ── 3. union-find ─────────────────────────────────────────────────
  const uf = new UnionFind(factRows.map((r) => r.id));
  const minSimByRoot = new Map<string, number>();
  for (const e of edgeRows) {
    // The pre-fetched fact set excluded already-consolidated facts;
    // edges into them won't appear because their ids aren't in
    // factsById. We re-check anyway to stay defensive: any edge to an
    // unknown id is skipped.
    if (!factsById.has(e.a_id) || !factsById.has(e.b_id)) continue;
    const sim = typeof e.sim === "string" ? Number.parseFloat(e.sim) : e.sim;
    uf.union(e.a_id, e.b_id);
    const root = uf.find(e.a_id);
    const prev = minSimByRoot.get(root);
    if (prev === undefined || sim < prev) minSimByRoot.set(root, sim);
  }

  // ── 4. roll up by root → drop singletons + small clusters ─────────
  const memberIdsByRoot = new Map<string, string[]>();
  for (const id of factsById.keys()) {
    const root = uf.find(id);
    let arr = memberIdsByRoot.get(root);
    if (!arr) {
      arr = [];
      memberIdsByRoot.set(root, arr);
    }
    arr.push(id);
  }

  const clusters: ConsolidationCluster[] = [];
  for (const [root, memberIds] of memberIdsByRoot.entries()) {
    if (memberIds.length < minClusterSize) continue;
    const members = memberIds
      .map((id) => factsById.get(id))
      .filter((f): f is MnemoFact => Boolean(f));
    if (members.length < minClusterSize) continue;
    // The cluster's subject/kind are constant by construction — the
    // self-join enforced it. Read from the first member.
    const first = members[0]!;
    clusters.push({
      subject: first.subject,
      kind: first.kind,
      members,
      cosineMin: minSimByRoot.get(root) ?? minCosine,
    });
    if (clusters.length >= maxClusters) break;
  }

  // Larger clusters first — they save more recall noise per LLM call.
  clusters.sort((a, b) => b.members.length - a.members.length);
  return clusters;
}

/**
 * Map a raw mnemo_fact row to the canonical `MnemoFact`. Mirrors the
 * helper in janitor/dedup; kept private here so the consolidation
 * module stays self-contained.
 */
function rowToFact(r: CandidateRow): MnemoFact {
  const metadata =
    typeof r.metadata === "string"
      ? (JSON.parse(r.metadata) as Record<string, unknown>)
      : r.metadata;
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    agentId: r.agent_id,
    scope: r.scope,
    scopeRef: r.scope_ref,
    kind: r.kind,
    subject: r.subject,
    statement: r.statement,
    confidence: typeof r.confidence === "string" ? Number.parseFloat(r.confidence) : r.confidence,
    pinned: r.pinned,
    relevance: typeof r.relevance === "string" ? Number.parseFloat(r.relevance) : r.relevance,
    hitCount: r.hit_count,
    lastRecalledAt: r.last_recalled_at ? new Date(r.last_recalled_at) : null,
    sourceMessageIds: r.source_message_ids ?? [],
    attributedTo: r.attributed_to,
    linkedMemoryIds: r.linked_memory_ids ?? [],
    embedding: null,
    metadata: metadata ?? {},
    status: r.status,
    mergedIntoId: r.merged_into_id,
    validFrom: new Date(r.valid_from),
    validTo: r.valid_to ? new Date(r.valid_to) : null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}
