import "server-only";
import { schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import {
  blockersMessage,
  computeBlockers,
  hasBlockers,
  loadFlowDeleteContext,
} from "./delete-impact";
import {
  AdminError,
  auditAdmin,
  confirmName,
  withAdminTx,
  type AdminActor,
  type AdminDb,
} from "@/lib/workspace-admin";

async function impact(tx: AdminDb, workspaceId: string, id: string) {
  const context = await loadFlowDeleteContext(workspaceId, id, tx);
  if (!context) throw new AdminError("Flow not found", 404);
  return { flow: context.flow, blockers: computeBlockers(context), counts: context.counts };
}
export function getFlowDeleteImpact(actor: AdminActor, id: string) {
  return withAdminTx(actor, (tx) => impact(tx, actor.workspaceId, id));
}
export function deleteFlow(actor: AdminActor, id: string, confirm: unknown) {
  return withAdminTx(actor, async (tx) => {
    const result = await impact(tx, actor.workspaceId, id);
    confirmName(confirm, result.flow.name);
    if (hasBlockers(result.blockers)) throw new AdminError(blockersMessage(result.blockers));
    const [deleted] = await tx
      .delete(schema.flows)
      .where(
        and(
          eq(schema.flows.id, id),
          eq(schema.flows.workspaceId, actor.workspaceId),
          eq(schema.flows.name, result.flow.name),
          eq(schema.flows.enabled, false)
        )
      )
      .returning({ id: schema.flows.id });
    if (!deleted) throw new AdminError("Flow not found", 404);
    await auditAdmin(tx, actor, "flow", "delete", result.flow);
    return { ok: true, counts: result.counts };
  });
}
