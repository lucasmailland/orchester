import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import { and, eq, lte, isNotNull } from "drizzle-orm";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { enqueue, JOB_FLOW_RUN } from "@/lib/queue";
import { computeNextRun } from "@/lib/cron";
import { safeLogError } from "@/lib/safe-log";

/**
 * Select every enabled flow_schedule whose nextRunAt is due (<= now),
 * enqueue a JOB_FLOW_RUN for each (creating its flow_run row), and
 * advance nextRunAt. Cross-tenant by design — runs under
 * withCrossTenantAdmin exactly like the reaper cron.
 *
 * Returns the number of schedules fired.
 */
export async function runDueSchedules(): Promise<number> {
  const now = new Date();
  return withCrossTenantAdmin("flow-schedule-poller", async (tx) => {
    const due = await tx
      .select()
      .from(schema.flowSchedules)
      .where(
        and(
          eq(schema.flowSchedules.enabled, true),
          isNotNull(schema.flowSchedules.nextRunAt),
          lte(schema.flowSchedules.nextRunAt, now)
        )
      );

    let fired = 0;
    for (const sched of due) {
      const flowRows = await tx
        .select()
        .from(schema.flows)
        .where(eq(schema.flows.id, sched.flowId))
        .limit(1);
      const flow = flowRows[0];

      const next = computeNextRun(sched.cron, sched.timezone, now);
      if (!next) {
        safeLogError(`[flow-schedule] invalid cron on schedule ${sched.id}`, sched.cron);
      }
      await tx
        .update(schema.flowSchedules)
        .set({
          lastRunAt: now,
          nextRunAt: next ?? new Date(now.getTime() + 24 * 3600 * 1000),
        })
        .where(eq(schema.flowSchedules.id, sched.id));

      if (!flow || flow.status === "paused") continue;

      const runId = createId();
      await tx.insert(schema.flowRuns).values({
        id: runId,
        flowId: sched.flowId,
        workspaceId: sched.workspaceId,
        status: "pending",
        triggerSource: `schedule:${sched.id}`,
        input: {},
      });
      await enqueue(JOB_FLOW_RUN, {
        runId,
        flowId: sched.flowId,
        workspaceId: sched.workspaceId,
        triggerSource: `schedule:${sched.id}`,
        input: {},
      });
      fired++;
    }
    return fired;
  });
}
