// apps/web/app/api/mnemo/cron-schedules/route.ts
//
// GET /api/mnemo/cron-schedules
//
// Returns the per-workspace cron periodicity overrides for the
// Memory Maintenance panel. Always returns one row per known job —
// jobs without an explicit override come back as `mode='default'`
// + `lastRunAt=null` so the UI can render the default state without
// a separate "no data" branch.
//
// RBAC: admin+.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { isAuthContext, requireAuth } from "@/lib/auth-guards";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import {
  CRON_JOBS,
  type CronJobKey,
  type CronJobName,
  type CronMode,
} from "@/lib/mnemo/cron-policy";

interface ScheduleResponseRow {
  /** UI-friendly key (matches MemoryOpsClient TASKS array `key`). */
  jobKey: CronJobKey;
  /** Internal job name persisted in the DB. */
  jobName: CronJobName;
  mode: CronMode;
  customCronExpression: string | null;
  lastRunAt: string | null;
}

interface OverrideRow {
  job_name: string;
  mode: string;
  custom_cron_expression: string | null;
  last_run_at: Date | null;
}

export async function GET(): Promise<NextResponse> {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx as unknown as NextResponse;

  const overrides: OverrideRow[] = await withCrossTenantAdmin(
    "mnemo.cron-schedules.list",
    async (tx) => {
      const result = await tx.execute(sql`
        SELECT job_name, mode, custom_cron_expression, last_run_at
        FROM mnemo_cron_schedule
        WHERE workspace_id = ${ctx.workspace.id}
      `);
      // drizzle's execute returns a result with `.rows`; cast through unknown
      // because the runtime shape varies by driver. We immediately project
      // into our typed OverrideRow above.
      return (result as unknown as { rows: OverrideRow[] }).rows ?? [];
    }
  );

  const byName = new Map(overrides.map((r) => [r.job_name, r]));

  const rows: ScheduleResponseRow[] = (Object.keys(CRON_JOBS) as CronJobKey[]).map((jobKey) => {
    const jobName = CRON_JOBS[jobKey];
    const row = byName.get(jobName);
    return {
      jobKey,
      jobName,
      mode: (row?.mode ?? "default") as CronMode,
      customCronExpression: row?.custom_cron_expression ?? null,
      lastRunAt: row?.last_run_at ? row.last_run_at.toISOString() : null,
    };
  });

  return NextResponse.json({ schedules: rows });
}
