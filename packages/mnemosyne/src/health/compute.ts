// packages/mnemosyne/src/health/compute.ts
//
// `computeHealthSnapshot` — pure metrics calculator for the v1.2
// memory drift detection feature.
//
// Each metric is a small, scoped SQL query against the existing
// mnemo_* tables. The caller is responsible for opening a workspace-
// scoped transaction (`withMnemoTx`) so RLS+FORCE applies and the
// queries can ONLY see this workspace's rows; we keep this file pure
// (no `withMnemoTx` call here) so it composes with the cron and with
// ad-hoc on-demand recomputes from the API layer.
//
// §0.1: package-clean — no `server-only`, no host imports. Drizzle's
// `sql` template suffices for every count; the schema definitions live
// in `@orchester/db` and are imported lazily through the tx.
import { sql } from "drizzle-orm";
import type { Tx } from "../tx";

/**
 * Computed snapshot — the in-memory shape of one `mnemo_health` row.
 * Mirrors the table 1:1; persistence is in `./index.ts`.
 */
export interface HealthSnapshot {
  workspaceId: string;
  snapshotAt: Date;
  // counts
  factCountActive: number;
  factCountArchived: number;
  factCountEmbedded: number;
  factCountUnembedded: number;
  decisionCountActive: number;
  relationCountConflicts: number;
  // hit-rate quality
  factsWithZeroHits: number;
  /** NULL when no telemetry exists yet (cold start). */
  recallHitRate30d: number | null;
  // extraction quality
  extractionJobsFailed7d: number;
  extractionJobsDeferred: number;
  // meta
  computedInMs: number;
}

export interface ComputeHealthSnapshotInput {
  workspaceId: string;
  /** Active workspace-scoped transaction (created by `withMnemoTx`). */
  tx: Tx;
}

/**
 * Run all metric queries inside the supplied transaction and return
 * the snapshot. The caller persists it via `persistHealthSnapshot`.
 *
 * Counts query exactly one table each so the planner can pick the
 * appropriate index without surprise. All queries are workspace-scoped
 * via explicit `WHERE workspace_id = $1`; RLS+FORCE provides the
 * defense-in-depth second gate.
 *
 * `recallHitRate30d` is null when no facts exist or none have been
 * candidates for recall in the window. We compute it as
 * `count(facts with last_recalled_at in window) / count(active facts)`
 * — a coarse proxy for "did recall return useful results" without
 * needing a separate `mnemo_recall_event` telemetry stream.
 */
export async function computeHealthSnapshot(
  input: ComputeHealthSnapshotInput
): Promise<HealthSnapshot> {
  const start = Date.now();
  const { workspaceId, tx } = input;

  // ── fact counts ────────────────────────────────────────────────────
  // One pass over mnemo_fact; SQL aggregates by status / embedding /
  // hit_count in a single sequential scan. For tiny workspaces this is
  // <1ms; for huge ones the partial indexes (mnemo_fact_workspace_status_*)
  // keep the cost bounded.
  const factRows = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'active')                                        AS active,
      COUNT(*) FILTER (WHERE status = 'forgotten' OR status = 'merged')                AS archived,
      COUNT(*) FILTER (WHERE status = 'active' AND embedding IS NOT NULL)              AS embedded,
      COUNT(*) FILTER (WHERE status = 'active' AND embedding IS NULL)                  AS unembedded,
      COUNT(*) FILTER (WHERE status = 'active' AND hit_count = 0)                      AS zero_hits,
      COUNT(*) FILTER (WHERE status = 'active' AND last_recalled_at IS NOT NULL
                              AND last_recalled_at > now() - interval '30 days')       AS recalled_30d
    FROM mnemo_fact
    WHERE workspace_id = ${workspaceId}
  `)) as unknown as Array<{
    active: string | number;
    archived: string | number;
    embedded: string | number;
    unembedded: string | number;
    zero_hits: string | number;
    recalled_30d: string | number;
  }>;
  const fact = factRows[0] ?? {
    active: 0,
    archived: 0,
    embedded: 0,
    unembedded: 0,
    zero_hits: 0,
    recalled_30d: 0,
  };
  const factCountActive = toInt(fact.active);
  const factCountArchived = toInt(fact.archived);
  const factCountEmbedded = toInt(fact.embedded);
  const factCountUnembedded = toInt(fact.unembedded);
  const factsWithZeroHits = toInt(fact.zero_hits);
  const recalled30d = toInt(fact.recalled_30d);

  // Hit-rate is meaningless when there are no active facts to recall;
  // surface null so the dashboard can render "no data yet" rather than
  // "0% (alarming!)".
  const recallHitRate30d = factCountActive > 0 ? recalled30d / factCountActive : null;

  // ── decisions ──────────────────────────────────────────────────────
  const decisionRows = (await tx.execute(sql`
    SELECT COUNT(*) AS c
    FROM mnemo_decision
    WHERE workspace_id = ${workspaceId} AND status = 'active'
  `)) as unknown as Array<{ c: string | number }>;
  const decisionCountActive = toInt(decisionRows[0]?.c ?? 0);

  // ── relations: count conflict markers ──────────────────────────────
  // Includes both pending and judged — the dashboard cares about the
  // total surface area of contradictions, not just the unresolved tail.
  const relationRows = (await tx.execute(sql`
    SELECT COUNT(*) AS c
    FROM mnemo_relation
    WHERE workspace_id = ${workspaceId} AND relation = 'conflicts_with'
  `)) as unknown as Array<{ c: string | number }>;
  const relationCountConflicts = toInt(relationRows[0]?.c ?? 0);

  // ── extraction jobs: failures (7d) + currently-deferred ────────────
  const jobRows = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE state = 'failed'
                         AND created_at > now() - interval '7 days')      AS failed_7d,
      COUNT(*) FILTER (WHERE state = 'deferred_provider_outage')          AS deferred
    FROM mnemo_extraction_job
    WHERE workspace_id = ${workspaceId}
  `)) as unknown as Array<{ failed_7d: string | number; deferred: string | number }>;
  const extractionJobsFailed7d = toInt(jobRows[0]?.failed_7d ?? 0);
  const extractionJobsDeferred = toInt(jobRows[0]?.deferred ?? 0);

  return {
    workspaceId,
    snapshotAt: new Date(),
    factCountActive,
    factCountArchived,
    factCountEmbedded,
    factCountUnembedded,
    decisionCountActive,
    relationCountConflicts,
    factsWithZeroHits,
    recallHitRate30d,
    extractionJobsFailed7d,
    extractionJobsDeferred,
    computedInMs: Date.now() - start,
  };
}

/** Postgres `COUNT(*)` returns bigint → drizzle returns string in some
 * configs, number in others. Normalise. */
function toInt(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? Number.parseInt(v, 10) : Math.trunc(v);
  return Number.isFinite(n) ? n : 0;
}
