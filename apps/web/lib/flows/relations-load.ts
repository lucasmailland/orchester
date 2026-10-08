import "server-only";
import { schema } from "@orchester/db";
import { and, count, eq } from "drizzle-orm";
import { withWorkspaceTx } from "@/lib/tenant/context";
import { computeFlowRelations, type FlowRelations, type TriggerCounts } from "./relations";

/**
 * Enabled webhooks and schedules per flow of one workspace: one grouped query
 * each. Both tables have FORCE RLS, so the reads run in the workspace
 * transaction (as `app_user`); the explicit workspace filter stays as a guard.
 */
export async function loadTriggerCounts(workspaceId: string): Promise<TriggerCounts> {
  const [hooks, schedules] = await withWorkspaceTx(workspaceId, async (tx) => [
    await tx
      .select({ flowId: schema.flowWebhooks.flowId, n: count() })
      .from(schema.flowWebhooks)
      .where(
        and(eq(schema.flowWebhooks.workspaceId, workspaceId), eq(schema.flowWebhooks.enabled, true))
      )
      .groupBy(schema.flowWebhooks.flowId),
    await tx
      .select({ flowId: schema.flowSchedules.flowId, n: count() })
      .from(schema.flowSchedules)
      .where(
        and(
          eq(schema.flowSchedules.workspaceId, workspaceId),
          eq(schema.flowSchedules.enabled, true)
        )
      )
      .groupBy(schema.flowSchedules.flowId),
  ]);
  const out: TriggerCounts = {};
  for (const h of hooks) out[h.flowId] = { webhooks: Number(h.n), schedules: 0 };
  for (const s of schedules) {
    out[s.flowId] = { webhooks: out[s.flowId]?.webhooks ?? 0, schedules: Number(s.n) };
  }
  return out;
}

/** Relations of one flow, through the workspace-bound service (404s like `describe`). */
export async function loadFlowRelations(
  actor: import("./service").FlowActor,
  flowId: string
): Promise<FlowRelations> {
  const svc = await import("./service");
  await svc.getFlow(actor, flowId);
  const all = await svc.listFlows(actor);
  const rel = computeFlowRelations(all, await loadTriggerCounts(actor.workspaceId));
  return rel[flowId] as FlowRelations;
}
