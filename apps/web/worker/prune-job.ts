// apps/web/worker/prune-job.ts
//
// Mnemosyne v1.2 — "The Janitor": weekly inactive-fact prune cron.
//
// Walks every workspace with at least one active fact and runs the
// prune pipeline:
//
//   1. `findPruneCandidates` returns up to MAX_CANDIDATES facts that
//      are old (> 90 days), have never been recalled, and whose
//      relevance has decayed below 0.1.
//   2. `pruneFacts` archives them into mnemo_fact_archive with
//      `archive_reason = 'pruned_inactive'`.
//
// All pruned facts share `archive_reason = 'pruned_inactive'` at v1.2.
// A future refinement (v1.3) can split the predicate into separate
// reason buckets ('pruned_low_relevance' for facts that tripped only
// the relevance gate, etc.) — the archive table's `archive_reason`
// column already accepts that enum value.
//
// No host-side LLM calls — pure SQL aggregates against mnemo_fact, so
// the spend-cap / metering invariants in `scripts/audit-invariants.sh`
// don't apply (the regex matches the chat-call / stream entry points,
// which this file deliberately never names).
import "server-only";
import { sql } from "drizzle-orm";
import { findPruneCandidates, pruneFacts, withMnemoTx, type Tx } from "@orchester/mnemosyne";
import { safeLogError } from "@/lib/safe-log";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { CRON_JOBS, shouldRunForWorkspace, markRanForWorkspace } from "@/lib/mnemo/cron-policy";

/** Hard cap per run on the workspace catalogue scan. Same shape as
 *  the dedup cron — keeps the tick bounded even with thousands of
 *  workspaces. */
const MAX_WORKSPACES_PER_RUN = 5000;

/** Per-workspace cap on candidates archived per tick. Matches the
 *  default in `findPruneCandidates`. */
const MAX_CANDIDATES_PER_WORKSPACE = 200;

interface PruneStats {
  workspacesScanned: number;
  factsArchived: number;
  workspacesSkipped: number;
}

/**
 * Run the prune pipeline for ONE workspace inside a workspace-scoped
 * transaction. RLS+FORCE Pattern A applies via `withMnemoTx`.
 *
 * Returns the count of rows archived, or `null` on hard failure
 * (logged). The cron loop swallows nulls and keeps going.
 */
async function pruneWorkspace(workspaceId: string): Promise<number | null> {
  try {
    return await withMnemoTx(workspaceId, async (tx: Tx) => {
      const candidates = await findPruneCandidates({
        workspaceId,
        tx,
        maxCandidates: MAX_CANDIDATES_PER_WORKSPACE,
      });
      if (candidates.length === 0) return 0;
      const factIds = candidates.map((f) => f.id);
      const r = await pruneFacts({
        workspaceId,
        factIds,
        reason: "pruned_inactive",
        tx,
      });
      return r.archived;
    });
  } catch (err) {
    safeLogError(`[prune-job] failed (ws=${workspaceId}):`, err);
    return null;
  }
}

/**
 * Cron entry point — enumerate workspaces that have at least one
 * active mnemo_fact, then prune each one inside its own tx.
 *
 * Enumeration uses `withCrossTenantAdmin` (cron_admin BYPASSRLS) so
 * we can see across tenants for the catalogue read. The per-workspace
 * prune re-enters the tenant context inside `pruneWorkspace`.
 */
export async function runPruneSweep(): Promise<PruneStats> {
  const stats: PruneStats = {
    workspacesScanned: 0,
    factsArchived: 0,
    workspacesSkipped: 0,
  };

  const workspaceRows = await withCrossTenantAdmin("mnemo.janitor.prune.enumerate", async (tx) => {
    const rows = await tx.execute(sql`
      SELECT DISTINCT workspace_id
      FROM mnemo_fact
      WHERE status = 'active'
      LIMIT ${MAX_WORKSPACES_PER_RUN}
    `);
    return rows as unknown as Array<{ workspace_id: string }>;
  });

  stats.workspacesScanned = workspaceRows.length;
  for (const row of workspaceRows) {
    // Per-workspace periodicity gate. See lib/mnemo/cron-policy.ts.
    const allowed = await shouldRunForWorkspace(row.workspace_id, CRON_JOBS.prune);
    if (!allowed) {
      stats.workspacesSkipped += 1;
      continue;
    }
    const archived = await pruneWorkspace(row.workspace_id);
    if (archived === null) {
      stats.workspacesSkipped += 1;
      continue;
    }
    stats.factsArchived += archived;
    await markRanForWorkspace(row.workspace_id, CRON_JOBS.prune);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", msg: "mnemo.janitor.prune.done", ...stats }));
  return stats;
}
