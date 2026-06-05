import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; did: string }> }
) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { did } = await params;
  const db = getDb();
  const { before, deleted } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    const beforeRow = (
      await tx
        .select({ title: schema.knowledgeDocs.title, kbId: schema.knowledgeDocs.kbId })
        .from(schema.knowledgeDocs)
        .where(
          and(
            eq(schema.knowledgeDocs.id, did),
            eq(schema.knowledgeDocs.workspaceId, ctx.workspace.id)
          )
        )
        .limit(1)
    )[0];
    const delRows = await tx
      .delete(schema.knowledgeDocs)
      .where(
        and(
          eq(schema.knowledgeDocs.id, did),
          eq(schema.knowledgeDocs.workspaceId, ctx.workspace.id)
        )
      )
      .returning({ id: schema.knowledgeDocs.id });
    return { before: beforeRow, deleted: delRows };
  });
  if (!deleted[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "kb.doc.delete",
    resource: "knowledge_doc",
    resourceId: did,
    before: before ? { title: before.title, kbId: before.kbId } : undefined,
  });
  return NextResponse.json({ ok: true });
}
