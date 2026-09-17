import "server-only";
import { schema } from "@orchester/db";
import { and, asc, desc, eq, or } from "drizzle-orm";
import { withWorkspaceTx } from "@/lib/tenant/context";
import { appendAuditInTx } from "@/lib/audit/log";
import type { AuditEntryInput } from "@/lib/audit/types";

type Tx = Parameters<Parameters<typeof withWorkspaceTx>[1]>[0];

/**
 * The only module of the flow service that touches Drizzle. Every query runs
 * inside `withWorkspaceTx` (app_user role + workspace GUC) and still filters by
 * workspace explicitly, so isolation does not rest on RLS alone. The workspace
 * condition comes first in each `where` so `lint:tenant` can see it.
 */
function repo(tx: Tx, onRotate: (seq: bigint) => void) {
  return {
    findFlow: async (id: string, ws: string) =>
      (
        await tx
          .select()
          .from(schema.flows)
          .where(and(eq(schema.flows.workspaceId, ws), eq(schema.flows.id, id)))
          .limit(1)
      )[0],
    listFlows: (ws: string) =>
      tx
        .select()
        .from(schema.flows)
        .where(eq(schema.flows.workspaceId, ws))
        .orderBy(desc(schema.flows.updatedAt)),
    insertFlow: async (row: typeof schema.flows.$inferInsert) =>
      (await tx.insert(schema.flows).values(row).returning())[0],
    updateFlow: async (id: string, ws: string, patch: Partial<typeof schema.flows.$inferInsert>) =>
      (
        await tx
          .update(schema.flows)
          .set(patch)
          .where(and(eq(schema.flows.workspaceId, ws), eq(schema.flows.id, id)))
          .returning()
      )[0],
    findRun: async (id: string, ws: string) =>
      (
        await tx
          .select()
          .from(schema.flowRuns)
          .where(and(eq(schema.flowRuns.workspaceId, ws), eq(schema.flowRuns.id, id)))
          .limit(1)
      )[0],
    // Only called after findRun has proven the run belongs to the workspace.
    listSteps: (runId: string) =>
      tx
        .select()
        .from(schema.flowRunSteps)
        .where(eq(schema.flowRunSteps.runId, runId))
        .orderBy(asc(schema.flowRunSteps.startedAt)),
    listRuns: (flowId: string, ws: string, limit: number) =>
      tx
        .select()
        .from(schema.flowRuns)
        .where(and(eq(schema.flowRuns.workspaceId, ws), eq(schema.flowRuns.flowId, flowId)))
        .orderBy(desc(schema.flowRuns.startedAt))
        .limit(limit),
    insertWebhook: async (row: typeof schema.flowWebhooks.$inferInsert) =>
      (await tx.insert(schema.flowWebhooks).values(row).returning())[0],
    listWebhooks: (flowId: string, ws: string) =>
      tx
        .select()
        .from(schema.flowWebhooks)
        .where(and(eq(schema.flowWebhooks.workspaceId, ws), eq(schema.flowWebhooks.flowId, flowId)))
        .orderBy(desc(schema.flowWebhooks.createdAt)),
    findTemplate: async (id: string, ws: string) =>
      (
        await tx
          .select()
          .from(schema.flowTemplates)
          .where(
            and(
              eq(schema.flowTemplates.id, id),
              or(eq(schema.flowTemplates.isPublic, true), eq(schema.flowTemplates.workspaceId, ws))
            )
          )
          .limit(1)
      )[0],
    audit: async (ws: string, entry: AuditEntryInput): Promise<void> => {
      const { rotatedAtSeq } = await appendAuditInTx(tx, ws, entry);
      if (rotatedAtSeq !== null) onRotate(rotatedAtSeq);
    },
  };
}

export type FlowRepo = ReturnType<typeof repo>;

export async function withRepo<T>(
  workspaceId: string,
  fn: (r: FlowRepo) => Promise<T>
): Promise<T> {
  const rotation: { seq: bigint | null } = { seq: null };
  const result = await withWorkspaceTx(workspaceId, (tx) =>
    fn(
      repo(tx, (seq) => {
        rotation.seq = seq;
      })
    )
  );
  // Same post-commit warning as appendAuditSync: a chain rotation must be visible.
  if (rotation.seq !== null) {
    const { safeLogWarn } = await import("@/lib/safe-log");
    safeLogWarn("[audit] chain rotated past legacy bootstrap row:", {
      level: "warn",
      msg: "audit.chain.rotated_past_legacy_bootstrap",
      workspaceId,
      seq: rotation.seq.toString(),
    });
  }
  return result;
}
