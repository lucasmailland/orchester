// apps/web/lib/gdpr/watchdog.ts
//
// Stalled-export reaper. The export worker (`runExportJob`) flips a row
// to `exporting` then drives it to `completed` / `failed` inside a
// single `withCrossTenantAdmin` transaction. If the worker process
// crashes (SIGKILL, OOM, container eviction) mid-pipeline the row stays
// `exporting` forever — pg-boss will retry the JOB, but the row's state
// machine never advances and the UI toast polls indefinitely.
//
// This cron runs every 15 minutes (registered in `worker/index.ts`),
// scans for `exporting` rows whose `startedAt` is older than 30 min,
// and flips them to `failed` with a sentinel error. The 30-minute
// cutoff is well past the p99 export time for any workspace we ship
// today (the biggest tenant we've seen completes in ~3 min). Increment
// `retryCount` so an operator triaging the DB can tell crash-loops
// apart from one-shot failures.
//
// Runs under `withCrossTenantAdmin` because it sweeps across every
// workspace by definition — same pattern as the audit chain verifier
// and the hard-delete cron.
import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { schema } from "@orchester/db";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { safeLogError } from "@/lib/safe-log";

/** How long an `exporting` row may sit before the watchdog flips it. */
const STALL_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Find every export job that has been `exporting` for longer than
 * `STALL_THRESHOLD_MS` and flip each one to `failed`. Returns nothing —
 * the caller (pg-boss cron) only cares that the job ran without
 * throwing. Per-row failures are logged via `safeLogError`.
 */
export async function runExportWatchdog(): Promise<void> {
  await withCrossTenantAdmin("gdpr.watchdog", async (tx) => {
    const cutoff = new Date(Date.now() - STALL_THRESHOLD_MS);
    const stuck = await tx
      .select()
      .from(schema.gdprExportJobs)
      .where(
        and(
          eq(schema.gdprExportJobs.state, "exporting"),
          lt(schema.gdprExportJobs.startedAt, cutoff)
        )
      );
    for (const job of stuck) {
      try {
        await tx
          .update(schema.gdprExportJobs)
          .set({
            state: "failed",
            error: "worker_crashed_or_stalled",
            retryCount: (job.retryCount ?? 0) + 1,
          })
          .where(eq(schema.gdprExportJobs.id, job.id));
        safeLogError(`[gdpr.watchdog] stalled job ${job.id} → failed`, {
          jobId: job.id,
          startedAt: job.startedAt,
        });
      } catch (e) {
        // One bad row shouldn't kill the sweep; log and continue.
        safeLogError(`[gdpr.watchdog] failed to flip job ${job.id}:`, e);
      }
    }
  });
}
