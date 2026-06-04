// apps/web/lib/mnemo/cron-policy.ts
//
// Per-workspace cron periodicity overrides for the Mnemosyne
// housekeeping jobs (dedup, prune, consolidation, summary, auto-pin,
// review-sweep, health, etc.).
//
// Why this exists
// ---------------
// The worker schedules each job globally in `worker/index.ts` via
// `boss.schedule(...)`. That's correct for the median tenant but
// operators kept asking:
//
//   "Can I disable dedup for this workspace? It's small, I don't
//    need it burning compute every Sunday."
//
//   "Can dedup run weekly here but monthly in the archive workspace?"
//
// This module is the consult-on-tick override. The DB table
// `mnemo_cron_schedule` (see migration 0052) stores, per (workspace,
// job), a mode + optional cron expression + a `last_run_at`
// bookkeeping field. The worker calls `shouldRunForWorkspace` BEFORE
// processing each workspace inside its global tick, then
// `markRanForWorkspace` after a successful per-workspace run.
//
// Contract caveat surfaced in the UI
// ----------------------------------
// The chosen mode is a MAXIMUM frequency. It cannot fire MORE often
// than the global cron — picking "hourly" on a job whose global is
// daily yields daily. Picking "weekly" on a daily job means the
// workspace runs every 7 days (skipping 6 ticks).
//
// API surface — both functions are stable and meant to be the ONLY
// way the worker talks to `mnemo_cron_schedule`. Don't bypass this
// to query the table from job code; the gate semantics live here.

import { sql } from "drizzle-orm";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";

/**
 * Canonical job catalogue. The job_name string in the DB must come
 * from this set — the API validates against it. Mirror order in
 * `MemoryOpsClient.tsx` (TASKS array) so the operator sees the same
 * label they edited.
 */
export const CRON_JOBS = {
  healthSnapshot: "mnemo-health-snapshot",
  dedup: "mnemo-dedup",
  prune: "mnemo-prune",
  remConsolidation: "mnemo-rem-consolidation",
  reviewSweep: "mnemo-review-sweep",
  autoPin: "mnemo-auto-pin",
  summaryRefresh: "mnemo-summary-refresh",
} as const;

export type CronJobKey = keyof typeof CRON_JOBS;
export type CronJobName = (typeof CRON_JOBS)[CronJobKey];

export type CronMode =
  | "default"
  | "disabled"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "custom";

/**
 * Minimum interval (in milliseconds) for each mode. Used by the
 * elapsed-time gate inside `shouldRunForWorkspace`. The intervals are
 * intentionally on the conservative side (slightly less than the
 * literal calendar period) so a "weekly" schedule fires reliably on
 * day 7 even when the worker's tick happens to land a few minutes
 * before the previous week's run.
 */
const INTERVAL_MS: Record<Exclude<CronMode, "default" | "disabled" | "custom">, number> = {
  hourly: 60 * 60 * 1000 - 60_000, // ~59 min — fire on the next tick after an hour
  daily: 24 * 60 * 60 * 1000 - 5 * 60_000, // ~23h 55m
  weekly: 7 * 24 * 60 * 60 * 1000 - 30 * 60_000, // ~6d 23h 30m
  monthly: 30 * 24 * 60 * 60 * 1000 - 60 * 60_000, // ~29d 23h
};

/**
 * Coarse interval for a custom cron expression. We deliberately do
 * NOT parse the cron expression here: the worker would have to pull
 * in `cron-parser` and we'd inherit any of its CVEs. Instead, custom
 * mode means "the operator wrote a cron string and stored it for
 * documentation; treat it like daily for gating purposes." If they
 * truly need something more aggressive than daily they can use the
 * preset modes; if they need slower, picking `monthly` works.
 *
 * A future iteration can swap this for a real cron parser without
 * changing call sites.
 */
const CUSTOM_FALLBACK_MS = INTERVAL_MS.daily;

interface ScheduleRow {
  mode: CronMode;
  lastRunAt: Date | null;
  customCronExpression: string | null;
}

/**
 * Read the (workspace, job) override row. Returns `null` when no row
 * exists yet — callers treat that as `mode='default'`.
 *
 * Uses the cross-tenant admin connection because the worker is
 * already iterating workspaces and doesn't have a per-workspace tx
 * up the call chain.
 */
async function readSchedule(
  workspaceId: string,
  jobName: CronJobName
): Promise<ScheduleRow | null> {
  return withCrossTenantAdmin("mnemo.cron-policy.read", async (tx) => {
    const rows = await tx.execute<{
      mode: string;
      last_run_at: Date | null;
      custom_cron_expression: string | null;
    }>(sql`
      SELECT mode, last_run_at, custom_cron_expression
      FROM mnemo_cron_schedule
      WHERE workspace_id = ${workspaceId} AND job_name = ${jobName}
      LIMIT 1
    `);
    const r = (rows as unknown as { rows: ScheduleRow[] }).rows?.[0] ?? null;
    if (!r) return null;
    return {
      mode: r.mode as CronMode,
      lastRunAt: r.lastRunAt ?? null,
      customCronExpression: r.customCronExpression ?? null,
    };
  });
}

/**
 * Decide whether to process this workspace on the current global tick.
 *
 * Returns true when:
 *  - no override row exists (defaults to "run")
 *  - the override is `default` (defer to the global cron — always run)
 *  - the override is an interval mode AND enough time has elapsed
 *    since the previous successful per-workspace run
 *
 * Returns false when:
 *  - the override is `disabled`
 *  - an interval mode hasn't elapsed yet
 *
 * Errors are swallowed and the caller gets `true` so a bad DB lookup
 * never silently disables a workspace — the global cron has to be
 * the safe default.
 */
export async function shouldRunForWorkspace(
  workspaceId: string,
  jobName: CronJobName
): Promise<boolean> {
  let row: ScheduleRow | null;
  try {
    row = await readSchedule(workspaceId, jobName);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[cron-policy] readSchedule failed ws=${workspaceId} job=${jobName} — defaulting to run.`,
      err
    );
    return true;
  }

  if (!row || row.mode === "default") return true;
  if (row.mode === "disabled") return false;

  // Interval modes: gate on elapsed wall-clock since the last run.
  // First-ever run with an interval mode is allowed (lastRunAt = null).
  const intervalMs = row.mode === "custom" ? CUSTOM_FALLBACK_MS : INTERVAL_MS[row.mode];
  if (row.lastRunAt === null) return true;
  const elapsed = Date.now() - row.lastRunAt.getTime();
  return elapsed >= intervalMs;
}

/**
 * Record that the workspace was processed for this job. Upserts the
 * row so first-time runs persist the `last_run_at` even when the
 * operator hasn't set an explicit override yet (we still need the
 * bookkeeping for any future override they pick).
 *
 * Errors are logged and swallowed — losing a `last_run_at` write just
 * means the workspace runs again next tick; not a correctness issue.
 */
export async function markRanForWorkspace(
  workspaceId: string,
  jobName: CronJobName
): Promise<void> {
  try {
    await withCrossTenantAdmin("mnemo.cron-policy.mark", async (tx) => {
      // The `id` column is `text PRIMARY KEY`; we synthesize a stable
      // value derived from (ws, job) so the upsert is idempotent and
      // doesn't pollute the row count on retries.
      const id = `${workspaceId}:${jobName}`;
      await tx.execute(sql`
        INSERT INTO mnemo_cron_schedule
          (id, workspace_id, job_name, mode, last_run_at, updated_at)
        VALUES
          (${id}, ${workspaceId}, ${jobName}, 'default', now(), now())
        ON CONFLICT (workspace_id, job_name) DO UPDATE
          SET last_run_at = now(), updated_at = now()
      `);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[cron-policy] markRanForWorkspace failed ws=${workspaceId} job=${jobName}`, err);
  }
}
