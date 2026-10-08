import "server-only";
import { withWorkspaceTx } from "@/lib/tenant/context";
import { sql } from "drizzle-orm";
import { appendAuditInTx, type AuditTx } from "@/lib/audit/log";
import type { FlowActor } from "@/lib/flows/service";

export type AdminActor = FlowActor;
export type AdminDb = AuditTx;

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status = 409
  ) {
    super(message);
  }
}

export function adminErrorResponse(error: unknown): Response {
  if (error instanceof AdminError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

/** Bind RLS and audit to the same transaction as the mutation. */
export function withAdminTx<T>(actor: AdminActor, fn: (tx: AdminDb) => Promise<T>) {
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.user_id', ${actor.kind === "user" ? actor.userId : ""}, true)`
    );
    return fn(tx);
  });
}

export function confirmName(confirm: unknown, name: string) {
  if (confirm !== name)
    throw new AdminError("confirm must equal the current resource name exactly.");
}

export async function auditAdmin(
  tx: AdminDb,
  actor: AdminActor,
  resource: string,
  action: string,
  row: { id: string; name: string }
) {
  await appendAuditInTx(tx, actor.workspaceId, {
    action: `${resource}.${action}`,
    actorKind: actor.kind === "apiKey" ? "api_key" : "user",
    actorUserId: actor.kind === "user" ? actor.userId : null,
    targetType: resource,
    targetId: row.id,
    meta: {
      ...(actor.kind === "apiKey" ? { apiKeyId: actor.keyId } : {}),
      [action === "delete" ? "before" : "after"]: { name: row.name },
    },
  });
}
