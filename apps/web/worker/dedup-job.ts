// apps/web/worker/dedup-job.ts
//
// Mnemosyne v1.2 — "The Janitor": weekly semantic dedup cron.
//
// Walks every workspace that has at least one embedded fact and runs
// the dedup pipeline:
//
//   1. `findDedupCandidates` returns up to MAX_CLUSTERS clusters of
//      near-duplicate facts (cosine >= 0.92).
//   2. For each cluster, `mergeCluster` archives the duplicates and
//      folds their hit_count + source_message_ids into the primary.
//
// No host-side LLM calls — pgvector handles the math server-side, so
// the spend-cap / metering invariants in `scripts/audit-invariants.sh`
// don't apply (the regex matches the chat-call / stream entry points,
// which this file deliberately never names).
//
// Idempotent by construction: a re-run on an already-deduped workspace
// finds zero clusters and returns immediately.
import "server-only";
import { sql } from "drizzle-orm";
import {
  findDedupCandidates,
  mergeCluster,
  withMnemoTx,
  type DedupCandidate,
  type Tx,
} from "@orchester/mnemosyne";
import { safeLogError } from "@/lib/safe-log";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
// Per-workspace periodicity override gate. Driven by the
// `mnemo_cron_schedule` table (migration 0052) + the Memory
// Maintenance UI in Settings → Memory maintenance. Each workspace
// can disable this job entirely or slow it down (weekly→monthly,
// etc.). See apps/web/lib/mnemo/cron-policy.ts.
import { CRON_JOBS, shouldRunForWorkspace, markRanForWorkspace } from "@/lib/mnemo/cron-policy";

/** Hard cap per run to keep the cron tick bounded even on a
 *  pathologically-large workspace catalogue. The next tick catches up. */
const MAX_WORKSPACES_PER_RUN = 5000;

/** Per-workspace cap on clusters to merge in one tick. Matches the
 *  default in `findDedupCandidates`; the next weekly tick picks up the
 *  long tail. */
const MAX_CLUSTERS_PER_WORKSPACE = 50;

interface DedupStats {
  workspacesScanned: number;
  clustersMerged: number;
  factsArchived: number;
  workspacesSkipped: number;
}

/**
 * Run the dedup pipeline for ONE workspace inside a workspace-scoped
 * transaction. RLS+FORCE Pattern A applies because `withMnemoTx` sets
 * the GUC + downgrades the role.
 *
 * Returns the count of clusters merged and rows archived. Returns
 * `null` only on hard failure (logged), so the cron loop can keep
 * going.
 */
async function dedupWorkspace(
  workspaceId: string
): Promise<{ clusters: number; archived: number } | null> {
  try {
    return await withMnemoTx(workspaceId, async (tx: Tx) => {
      const candidates: DedupCandidate[] = await findDedupCandidates({
        workspaceId,
        tx,
        maxClusters: MAX_CLUSTERS_PER_WORKSPACE,
      });
      if (candidates.length === 0) return { clusters: 0, archived: 0 };
      let archived = 0;
      for (const cluster of candidates) {
        const r = await mergeCluster({ workspaceId, cluster, tx });
        archived += r.merged;
      }
      return { clusters: candidates.length, archived };
    });
  } catch (err) {
    safeLogError(`[dedup-job] failed (ws=${workspaceId}):`, err);
    return null;
  }
}

/**
 * Cron entry point — enumerate workspaces that have at least one
 * embedded mnemo_fact row (Mode A workspaces don't participate in
 * semantic dedup), then dedup each one inside its own tx.
 *
 * Enumeration uses `withCrossTenantAdmin` (cron_admin BYPASSRLS) so
 * we can see across tenants for the catalogue read. The per-workspace
 * merge re-enters the tenant context inside `dedupWorkspace`.
 */
export async function runDedupSweep(): Promise<DedupStats> {
  const stats: DedupStats = {
    workspacesScanned: 0,
    clustersMerged: 0,
    factsArchived: 0,
    workspacesSkipped: 0,
  };

  const workspaceRows = await withCrossTenantAdmin("mnemo.janitor.dedup.enumerate", async (tx) => {
    const rows = await tx.execute(sql`
      SELECT DISTINCT workspace_id
      FROM mnemo_fact
      WHERE status = 'active' AND embedding IS NOT NULL
      LIMIT ${MAX_WORKSPACES_PER_RUN}
    `);
    return rows as unknown as Array<{ workspace_id: string }>;
  });

  stats.workspacesScanned = workspaceRows.length;
  for (const row of workspaceRows) {
    // Per-workspace gate: skip if the operator opted out or asked
    // for a slower cadence than the global cron. The gate fails-open
    // on error (logged inside the helper) so a transient DB issue
    // can't silently disable a tenant.
    const allowed = await shouldRunForWorkspace(row.workspace_id, CRON_JOBS.dedup);
    if (!allowed) {
      stats.workspacesSkipped += 1;
      continue;
    }
    const result = await dedupWorkspace(row.workspace_id);
    if (result === null) {
      stats.workspacesSkipped += 1;
      continue;
    }
    stats.clustersMerged += result.clusters;
    stats.factsArchived += result.archived;
    // Bookkeeping for the elapsed-time gate. Best-effort; the helper
    // swallows errors so a missed write just means we re-run next tick.
    await markRanForWorkspace(row.workspace_id, CRON_JOBS.dedup);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", msg: "mnemo.janitor.dedup.done", ...stats }));
  return stats;
}
