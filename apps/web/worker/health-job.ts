// apps/web/worker/health-job.ts
//
// Mnemosyne v1.2 — daily memory health snapshot cron.
//
// Walks every workspace that has at least one fact and computes a
// `mnemo_health` snapshot per workspace. No LLM calls anywhere on this
// path (every metric is a small COUNT/aggregate query against the
// existing mnemo_* tables), so the spend-cap / metering invariants in
// `scripts/audit-invariants.sh` don't apply — they only guard files
// that reach the chat-call or stream entry points.
//
// This is purely an OPTIMISATION: the API endpoint
// (`/api/mnemo/health`) can recompute on demand by passing
// `fresh: true`. The cron pre-computes so the dashboard renders the
// latest snapshot instantly, and so the timeseries table accumulates a
// useful history for drift charts in v1.3.
import "server-only";
import { sql } from "drizzle-orm";
import {
  computeHealthSnapshot,
  persistHealthSnapshot,
  withMnemoTx,
  type HealthSnapshot,
  type Tx,
} from "@/lib/dead-mnemo-stubs";
import { safeLogError } from "@/lib/safe-log";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { CRON_JOBS, shouldRunForWorkspace, markRanForWorkspace } from "@/lib/mnemo/cron-policy";

/** Hard cap per run. Protects against pathological growth of the
 *  workspace catalogue (and the cron still catches up on the next
 *  tick — snapshots are append-only, not gap-sensitive). */
const MAX_WORKSPACES_PER_RUN = 5000;

export interface HealthJobPayload {
  /** Single-workspace mode — refresh just this one. */
  workspaceId?: string;
}

interface JobLike {
  data: HealthJobPayload;
}

/**
 * Refresh a single workspace's snapshot. Runs the compute + persist
 * inside ONE `withMnemoTx` so RLS+FORCE applies and the writes are
 * atomic relative to the reads.
 */
async function refreshWorkspace(workspaceId: string): Promise<HealthSnapshot | null> {
  try {
    return await withMnemoTx(workspaceId, async (tx: Tx) => {
      const snap = await computeHealthSnapshot({ workspaceId, tx });
      await persistHealthSnapshot({ workspaceId, snapshot: snap, tx });
      return snap;
    });
  } catch (err) {
    safeLogError(`[health-job] refresh failed (ws=${workspaceId}):`, err);
    return null;
  }
}

/**
 * Cron entry point — enumerate workspaces with at least one mnemo_fact
 * row (no point computing a snapshot for an empty workspace), then
 * snapshot each one inside its own workspace tx.
 *
 * Enumeration is cross-tenant by design (cron_admin BYPASSRLS via
 * `withCrossTenantAdmin`). The per-workspace refresh re-enters the
 * tenant context inside `refreshWorkspace`.
 */
export async function runHealthSnapshotCron(): Promise<{
  workspacesScanned: number;
  workspacesSnapshotted: number;
  workspacesSkipped: number;
}> {
  const stats = { workspacesScanned: 0, workspacesSnapshotted: 0, workspacesSkipped: 0 };

  const workspaceRows = await withCrossTenantAdmin("mnemo.health.enumerate", async (tx) => {
    const rows = await tx.execute(sql`
      SELECT DISTINCT workspace_id
      FROM mnemo_fact
      LIMIT ${MAX_WORKSPACES_PER_RUN}
    `);
    return rows as unknown as Array<{ workspace_id: string }>;
  });

  stats.workspacesScanned = workspaceRows.length;
  for (const row of workspaceRows) {
    // Per-workspace periodicity gate. See lib/mnemo/cron-policy.ts.
    const allowed = await shouldRunForWorkspace(row.workspace_id, CRON_JOBS.healthSnapshot);
    if (!allowed) {
      stats.workspacesSkipped += 1;
      continue;
    }
    const snap = await refreshWorkspace(row.workspace_id);
    if (snap) {
      stats.workspacesSnapshotted += 1;
      await markRanForWorkspace(row.workspace_id, CRON_JOBS.healthSnapshot);
    } else {
      stats.workspacesSkipped += 1;
    }
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", msg: "mnemo.health.done", ...stats }));
  return stats;
}

/**
 * pg-boss handler — single-workspace payloads target one workspace;
 * empty payloads kick off the cron-wide sweep.
 */
export async function healthJobHandler(job: JobLike): Promise<void> {
  const wsId = job.data?.workspaceId;
  if (wsId) {
    await refreshWorkspace(wsId);
    return;
  }
  await runHealthSnapshotCron();
}
