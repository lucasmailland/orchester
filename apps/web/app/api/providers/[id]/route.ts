import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  // aiProviders is FORCED — wrap both the read and delete in a single
  // tx with the workspace GUC set local.
  const { before, deleted } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    const beforeRow = (
      await tx
        .select({ provider: schema.aiProviders.provider })
        .from(schema.aiProviders)
        .where(
          and(eq(schema.aiProviders.id, id), eq(schema.aiProviders.workspaceId, ctx.workspace.id))
        )
        .limit(1)
    )[0];
    const [delRow] = await tx
      .delete(schema.aiProviders)
      .where(
        and(eq(schema.aiProviders.id, id), eq(schema.aiProviders.workspaceId, ctx.workspace.id))
      )
      .returning({ id: schema.aiProviders.id });
    return { before: beforeRow, deleted: delRow };
  });
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "provider.delete",
    resource: "ai_provider",
    resourceId: id,
    before: before ? { provider: before.provider } : undefined,
  });
  return NextResponse.json({ ok: true });
}
