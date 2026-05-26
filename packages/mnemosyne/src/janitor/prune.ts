// packages/mnemosyne/src/janitor/prune.ts
//
// Mnemosyne v1.2 — "The Janitor": inactive-fact pruning pass.
//
// Periodically the prune cron walks every workspace and archives
// facts that look like noise: they're not pinned, they've never been
// recalled, they're at least 90 days old, AND their relevance has
// decayed below 0.1. Anything that fails ANY of those gates stays
// active (so a single recall keeps a fact alive indefinitely).
//
// Like dedup, prune writes to `mnemo_fact_archive` for audit — operators
// can recover an accidentally-pruned fact by id. The archive table
// omits the embedding column (migration 0029) so the cold store
// doesn't re-bloat.
//
// Both findPruneCandidates and pruneFacts accept a `tx: Tx` already
// wrapped by `withMnemoTx`; RLS+FORCE Pattern A applies inside.
import { sql } from "drizzle-orm";
import type { Tx } from "../tx";
import type { MnemoFact } from "../primitives/fact";

export interface FindPruneCandidatesInput {
  workspaceId: string;
  /** Age threshold in days — facts must be at least this old to be
   *  eligible for pruning. Default 90 days. */
  inactiveDays?: number;
  /** Relevance floor — facts at or above this stay active. Default
   *  0.1. Combined with the no-hits + age gates this catches facts
   *  whose extraction confidence was always low and that never earned
   *  back a hit through recall. */
  minRelevance?: number;
  /** Hard cap on candidates returned per workspace per run. Default
   *  200 — protects the cron tick from runaway work. The next tick
   *  catches up. */
  maxCandidates?: number;
  tx: Tx;
}

const DEFAULT_INACTIVE_DAYS = 90;
const DEFAULT_MIN_RELEVANCE = 0.1;
const DEFAULT_MAX_CANDIDATES = 200;

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

/**
 * Return up to `maxCandidates` facts eligible for pruning in the
 * supplied workspace.
 *
 * Predicate (all must hold):
 *   • status = 'active'
 *   • NOT pinned
 *   • hit_count = 0
 *   • (last_recalled_at IS NULL OR last_recalled_at < now() - inactiveDays)
 *   • created_at < now() - inactiveDays  (don't prune facts that never
 *                                          got a chance — must be old)
 *   • relevance < minRelevance
 *
 * Pure READ. The caller decides which subset to archive (e.g. split
 * by reason for analytics).
 */
export async function findPruneCandidates(input: FindPruneCandidatesInput): Promise<MnemoFact[]> {
  const inactiveDays = input.inactiveDays ?? DEFAULT_INACTIVE_DAYS;
  const minRelevance = input.minRelevance ?? DEFAULT_MIN_RELEVANCE;
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

  const rows = (await input.tx.execute(sql`
    SELECT
      id, workspace_id, agent_id, scope, scope_ref, kind, subject,
      statement, confidence, pinned, relevance, hit_count,
      last_recalled_at, source_message_ids, attributed_to,
      linked_memory_ids, metadata, status, merged_into_id,
      valid_from, valid_to, created_at, updated_at
    FROM mnemo_fact
    WHERE workspace_id = ${input.workspaceId}
      AND status = 'active'
      AND pinned = false
      AND hit_count = 0
      AND (last_recalled_at IS NULL
           OR last_recalled_at < now() - (${inactiveDays}::int * interval '1 day'))
      AND created_at < now() - (${inactiveDays}::int * interval '1 day')
      AND relevance < ${minRelevance}
    ORDER BY created_at ASC
    LIMIT ${maxCandidates}
  `)) as unknown as CandidateRow[];

  return rows.map(rowToFact);
}

export interface PruneFactsInput {
  workspaceId: string;
  factIds: string[];
  reason: "pruned_inactive" | "pruned_low_relevance";
  tx: Tx;
}

/**
 * Archive the supplied facts atomically inside the supplied
 * transaction.
 *
 * Steps:
 *   1. INSERT ... SELECT into mnemo_fact_archive with
 *      original_status = the row's current status, archived_at = now(),
 *      archive_reason = input.reason. The archive table omits the
 *      embedding column.
 *   2. DELETE the rows from mnemo_fact.
 *
 * Idempotent: re-running with the same ids after the first call is a
 * no-op (the SELECT finds nothing, the DELETE finds nothing).
 */
export async function pruneFacts(input: PruneFactsInput): Promise<{ archived: number }> {
  const { workspaceId, factIds, reason, tx } = input;
  if (factIds.length === 0) return { archived: 0 };

  // ── 1. archive copies ─────────────────────────────────────────────
  // Drizzle's `sql` template expands a raw JS array into `(p1, p2, ...)`
  // — a record literal — which Postgres can't cast to `text[]`. Wrap
  // via `sql.param` so the array goes through the encoder path intact
  // and the driver treats it as a single typed parameter.
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
      merged_into_id, now(), ${reason}, created_at, updated_at
    FROM mnemo_fact
    WHERE workspace_id = ${workspaceId}
      AND id = ANY(${sql.param(factIds)}::text[])
  `);

  // ── 2. delete from active table ───────────────────────────────────
  // No CTE / RETURNING needed — the count of rows the INSERT actually
  // copied equals the count of rows the DELETE finds, modulo concurrent
  // edits. We return the application-side requested count as a coarse
  // proxy; the actual archived count is the SELECT row count.
  const result = (await tx.execute(sql`
    DELETE FROM mnemo_fact
    WHERE workspace_id = ${workspaceId}
      AND id = ANY(${sql.param(factIds)}::text[])
    RETURNING id
  `)) as unknown as Array<{ id: string }>;

  return { archived: result.length };
}

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
