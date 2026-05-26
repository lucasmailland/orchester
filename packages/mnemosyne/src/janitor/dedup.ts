// packages/mnemosyne/src/janitor/dedup.ts
//
// Mnemosyne v1.2 — "The Janitor": semantic dedup pass.
//
// Periodically the dedup cron walks every workspace, fetches all
// active facts that have an embedding (Mode B/C), and clusters near-
// duplicates using pgvector cosine distance. Each cluster collapses
// into a single primary; the rest get archived into
// `mnemo_fact_archive` with `archive_reason = 'merged'` for audit.
//
// Why only embedded facts? FTS-only (Mode A) dedup would generate too
// many false positives ("user prefers espresso" vs. "user likes
// espresso"). With cosine we can set a deterministic threshold (0.92
// by default) and trust it.
//
// `findDedupCandidates` is a pure READ — the caller decides whether to
// merge each cluster. `mergeCluster` performs the atomic copy-archive-
// delete-update inside the supplied transaction. Both helpers receive
// a `tx: Tx` already wrapped by `withMnemoTx`, so RLS+FORCE Pattern A
// applies and we never need a workspace_id filter in the WHERE clauses
// (the GUC already scopes us). We DO repeat the workspace_id filter
// anyway — defense-in-depth + helps the planner pick the right index.
import { sql } from "drizzle-orm";
import type { Tx } from "../tx";
import type { MnemoFact } from "../primitives/fact";

/**
 * One cluster of near-duplicate facts.
 *   - `primary` is the row we KEEP. Picked by a composite score
 *     (relevance + confidence + log hit_count) so the most "earned"
 *     fact wins, not just the oldest or newest.
 *   - `duplicates` are the rows we ARCHIVE on merge.
 *   - `cosineMin` is the lowest pairwise similarity in the cluster
 *     (i.e. the weakest edge that union-find pulled together). The
 *     dashboard can use this to flag low-cohesion clusters for human
 *     review before auto-merge.
 */
export interface DedupCandidate {
  primary: MnemoFact;
  duplicates: MnemoFact[];
  cosineMin: number;
}

export interface FindDedupCandidatesInput {
  workspaceId: string;
  /** Minimum cosine similarity to call two facts duplicates. Default
   *  0.92 — empirically the cutoff where statements with the same
   *  semantic content but different phrasings cluster cleanly. */
  threshold?: number;
  /** Hard cap on clusters returned per run. Default 50 — protects the
   *  cron tick from runaway work in a workspace with thousands of
   *  duplicates after a backfill. The next tick picks up the rest. */
  maxClusters?: number;
  tx: Tx;
}

/** Hard cap on rows scanned per workspace per run. Workspaces that grow
 *  beyond this become a known pathological case for v1.3 (per-segment
 *  scan). At v1.2 typical workspaces have < 1000 facts. */
const SCAN_LIMIT = 5000;

/** Default similarity threshold (cosine). 0.92 is restrictive enough
 *  that semantically distinct facts almost never end up in the same
 *  cluster, but loose enough to catch the common case of two facts
 *  saying the same thing in slightly different words. */
const DEFAULT_THRESHOLD = 0.92;

const DEFAULT_MAX_CLUSTERS = 50;

interface CandidateRow {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  scope: "global" | "conversation" | "employee" | "team";
  scope_ref: string | null;
  kind: "preference" | "trait" | "event" | "relationship" | "skill" | "concern" | "other";
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
 * Walk the workspace's active embedded facts and return up to
 * `maxClusters` near-duplicate clusters.
 *
 * Algorithm:
 *   1. SELECT id + ranking fields from active mnemo_fact rows that
 *      carry an embedding. The full row is fetched (we need the
 *      statement / source_message_ids in the merge step).
 *   2. SELF-JOIN via pgvector's `<=>` cosine-distance operator with
 *      `<= (1 - threshold)`; this yields the symmetric undirected
 *      similarity graph. We restrict to `a.id < b.id` so each edge
 *      shows up once.
 *   3. Build clusters via union-find over the edges.
 *   4. For each connected component with ≥ 2 members, pick the
 *      composite-score winner as the primary.
 *
 * Pure READ — no writes happen here. `mergeCluster` performs the
 * archive + delete + update atomically.
 */
export async function findDedupCandidates(
  input: FindDedupCandidatesInput
): Promise<DedupCandidate[]> {
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const maxClusters = input.maxClusters ?? DEFAULT_MAX_CLUSTERS;
  const maxDistance = 1 - threshold; // pgvector's <=> is distance, not similarity.

  // ── 1. fetch active embedded facts ────────────────────────────────
  // Cap at SCAN_LIMIT so the self-join below stays bounded even in a
  // pathological workspace. Sort by id for stable ordering / planner
  // predictability.
  const factRows = (await input.tx.execute(sql`
    SELECT
      id, workspace_id, agent_id, scope, scope_ref, kind, subject,
      statement, confidence, pinned, relevance, hit_count,
      last_recalled_at, source_message_ids, attributed_to,
      linked_memory_ids, metadata, status, merged_into_id,
      valid_from, valid_to, created_at, updated_at
    FROM mnemo_fact
    WHERE workspace_id = ${input.workspaceId}
      AND status = 'active'
      AND embedding IS NOT NULL
    ORDER BY id
    LIMIT ${SCAN_LIMIT}
  `)) as unknown as CandidateRow[];

  if (factRows.length < 2) return [];

  const factsById = new Map<string, MnemoFact>();
  for (const r of factRows) factsById.set(r.id, rowToFact(r));

  // ── 2. self-join for edges ────────────────────────────────────────
  // We rely on the calling tx already scoping `app.workspace_id` via
  // `withMnemoTx`. The WHERE clause re-asserts workspace_id for index
  // selection. `a.id < b.id` gives us the upper triangle exactly once.
  const edgeRows = (await input.tx.execute(sql`
    SELECT
      a.id AS a_id,
      b.id AS b_id,
      1.0 - (a.embedding <=> b.embedding) AS sim
    FROM mnemo_fact a
    JOIN mnemo_fact b
      ON a.workspace_id = b.workspace_id
     AND a.id < b.id
    WHERE a.workspace_id = ${input.workspaceId}
      AND a.status = 'active'
      AND b.status = 'active'
      AND a.embedding IS NOT NULL
      AND b.embedding IS NOT NULL
      AND (a.embedding <=> b.embedding) <= ${maxDistance}
  `)) as unknown as EdgeRow[];

  if (edgeRows.length === 0) return [];

  // ── 3. union-find over edges ──────────────────────────────────────
  const uf = new UnionFind(factRows.map((r) => r.id));
  // Track the minimum similarity edge inside each component so the
  // returned `cosineMin` is meaningful.
  const minSimByRoot = new Map<string, number>();

  for (const e of edgeRows) {
    const sim = typeof e.sim === "string" ? Number.parseFloat(e.sim) : e.sim;
    uf.union(e.a_id, e.b_id);
    const root = uf.find(e.a_id);
    const prev = minSimByRoot.get(root);
    if (prev === undefined || sim < prev) minSimByRoot.set(root, sim);
  }

  // ── 4. roll members up by root ────────────────────────────────────
  const componentsByRoot = new Map<string, string[]>();
  for (const id of factsById.keys()) {
    const root = uf.find(id);
    let arr = componentsByRoot.get(root);
    if (!arr) {
      arr = [];
      componentsByRoot.set(root, arr);
    }
    arr.push(id);
  }

  const clusters: DedupCandidate[] = [];
  for (const [root, memberIds] of componentsByRoot.entries()) {
    if (memberIds.length < 2) continue; // singleton — nothing to dedup.
    const members = memberIds
      .map((id) => factsById.get(id))
      .filter((f): f is MnemoFact => Boolean(f));
    if (members.length < 2) continue;
    const primary = pickPrimary(members);
    const duplicates = members.filter((f) => f.id !== primary.id);
    // The lowest similarity edge that pulled this component together.
    // `1` as default would be misleading if union-find merged through a
    // singleton (it can't — singletons don't get edges) so this is
    // always overwritten by a real edge.
    const cosineMin = minSimByRoot.get(root) ?? threshold;
    clusters.push({ primary, duplicates, cosineMin });
    if (clusters.length >= maxClusters) break;
  }

  return clusters;
}

/**
 * Composite-score winner pick. Bias toward facts that have actually
 * been useful — high relevance, high confidence, lots of hits.
 *
 * Formula (matches the brief):
 *   0.4 * relevance + 0.3 * confidence + 0.3 * (log1p(hit_count) / log(100))
 *
 * The log-scale on hit_count caps the contribution so a single
 * pathological hot fact doesn't dominate — at 100 hits it adds
 * exactly 0.3, at 10 hits ~0.18, at 1 hit ~0.03.
 *
 * Pinned facts win unconditionally — if any duplicate is pinned, it
 * becomes the primary. We never archive a pinned fact silently.
 */
export function pickPrimary(facts: MnemoFact[]): MnemoFact {
  // First-class invariant: never archive a pinned fact.
  const pinned = facts.find((f) => f.pinned);
  if (pinned) return pinned;
  let best = facts[0]!;
  let bestScore = compositeScore(best);
  for (let i = 1; i < facts.length; i++) {
    const f = facts[i]!;
    const s = compositeScore(f);
    if (s > bestScore) {
      best = f;
      bestScore = s;
    }
  }
  return best;
}

function compositeScore(f: MnemoFact): number {
  const relevance = clamp01(f.relevance);
  const confidence = clamp01(f.confidence);
  const hits = Math.log1p(Math.max(0, f.hitCount)) / Math.log(100);
  return 0.4 * relevance + 0.3 * confidence + 0.3 * hits;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export interface MergeClusterInput {
  workspaceId: string;
  cluster: DedupCandidate;
  tx: Tx;
}

/**
 * Merge a dedup cluster atomically inside the supplied transaction.
 *
 * Steps:
 *   1. COPY every duplicate into `mnemo_fact_archive` with
 *      `archive_reason = 'merged'`, `merged_into_id = primary.id`,
 *      `original_status = 'active'`. The archive table omits the
 *      embedding column on purpose.
 *   2. DELETE the duplicate rows from `mnemo_fact`. Cascade FKs are
 *      not an issue — `mnemo_relation` rows referencing duplicates
 *      stay pointing at the archived id (caller can run a separate
 *      sweep to remap them in v1.3).
 *   3. UPDATE the primary in place:
 *        hit_count        = SUM(cluster.hit_count) -- captures
 *                           cumulative usefulness
 *        source_message_ids = UNION of all members' source_message_ids
 *        confidence       = MAX(cluster.confidence) -- best signal wins
 *        updated_at       = now()
 *
 * Idempotent under re-run: if the cluster has already been merged,
 * step 1 finds nothing to copy (duplicates were deleted), steps 2 + 3
 * become no-ops. A fresh `findDedupCandidates` run after this finds
 * nothing to merge.
 */
export async function mergeCluster(input: MergeClusterInput): Promise<{ merged: number }> {
  const { workspaceId, cluster, tx } = input;
  if (cluster.duplicates.length === 0) return { merged: 0 };

  const duplicateIds = cluster.duplicates.map((f) => f.id);

  // ── 1. archive copies ─────────────────────────────────────────────
  // Use INSERT ... SELECT FROM mnemo_fact so the copy is atomic and
  // we never round-trip the full row through the application. The
  // archive table omits embedding / text_lemmatized (migration 0029),
  // so we list columns explicitly.
  // Drizzle's `sql` template expands a raw JS array into `(p1, p2, ...)`
  // — a record literal — which Postgres can't cast to `text[]`. Wrap
  // via `sql.param` so the array goes through the encoder path
  // intact and the driver treats it as a single typed parameter.
  await tx.execute(sql`
    INSERT INTO mnemo_fact_archive (
      id, workspace_id, agent_id, scope, scope_ref, kind, subject,
      statement, confidence, pinned, relevance, hit_count,
      last_recalled_at, source_message_ids, metadata, original_status,
      merged_into_id, archived_at, archive_reason, created_at, updated_at
    )
    SELECT
      id, workspace_id, agent_id, scope, scope_ref, kind, subject,
      statement, confidence, pinned, relevance, hit_count,
      last_recalled_at, source_message_ids, metadata, status,
      ${cluster.primary.id}, now(), 'merged', created_at, updated_at
    FROM mnemo_fact
    WHERE workspace_id = ${workspaceId}
      AND id = ANY(${sql.param(duplicateIds)}::text[])
  `);

  // ── 2. delete duplicates from the active table ────────────────────
  await tx.execute(sql`
    DELETE FROM mnemo_fact
    WHERE workspace_id = ${workspaceId}
      AND id = ANY(${sql.param(duplicateIds)}::text[])
  `);

  // ── 3. update primary in place ────────────────────────────────────
  // hit_count gets the SUM (cluster usefulness folded in).
  // source_message_ids gets the UNION (de-duplicated via array_distinct).
  // confidence gets the MAX (best signal).
  const allIds = [cluster.primary.id, ...duplicateIds];
  const totalHits =
    cluster.primary.hitCount + cluster.duplicates.reduce((acc, d) => acc + d.hitCount, 0);
  const maxConfidence = Math.max(
    cluster.primary.confidence,
    ...cluster.duplicates.map((d) => d.confidence)
  );

  // Union the source_message_ids in SQL — array_agg(DISTINCT unnest)
  // — so we don't have to round-trip potentially thousands of ids
  // through the application. We previously DELETEd the duplicates, so
  // we lost their source_message_ids in the table — we already have
  // the values in `cluster.duplicates` on the application side.
  const allSourceIds = new Set<string>();
  for (const id of cluster.primary.sourceMessageIds) allSourceIds.add(id);
  for (const d of cluster.duplicates) for (const id of d.sourceMessageIds) allSourceIds.add(id);
  const merged = Array.from(allSourceIds);
  // `allIds` was retained so a future v1.3 cross-reference sweep can find
  // the merged-into chain via mnemo_fact_archive.merged_into_id.
  void allIds;

  await tx.execute(sql`
    UPDATE mnemo_fact
    SET
      hit_count = ${totalHits},
      confidence = ${maxConfidence},
      source_message_ids = ${sql.param(merged)}::text[],
      updated_at = now()
    WHERE workspace_id = ${workspaceId}
      AND id = ${cluster.primary.id}
  `);

  return { merged: cluster.duplicates.length };
}

/**
 * Map a raw mnemo_fact row (with embedding stripped) to the canonical
 * `MnemoFact` shape used by the rest of the package. We don't carry
 * the embedding through — the dedup pipeline doesn't need to re-parse
 * the vector; pgvector did the math server-side.
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

/**
 * Iterative union-find with path compression and union-by-rank.
 *
 * Exported for unit tests — the algorithm has its own edge cases
 * (empty input, self-edges) that are easier to exercise in isolation
 * than through a full DB-backed integration test.
 */
export class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  constructor(ids: Iterable<string>) {
    for (const id of ids) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: string): string {
    // Unknown ids report themselves as their own root — keeps callers
    // safe even when the union-find was constructed from a subset of
    // the actual id space.
    if (!this.parent.has(id)) return id;
    let cur = id;
    // Path compression — flatten the tree as we walk it.
    const path: string[] = [];
    let next = this.parent.get(cur) as string;
    while (next !== cur) {
      path.push(cur);
      cur = next;
      next = this.parent.get(cur) as string;
    }
    for (const node of path) this.parent.set(node, cur);
    return cur;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }
}
