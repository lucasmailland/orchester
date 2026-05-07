import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";
import { logAudit } from "@/lib/audit";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; did: string }> }
) {
  const ws = await getCurrentWorkspace();
  const session = await getCurrentSession();
  if (!ws || !session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { did } = await params;
  const db = getDb();
  const before = (
    await db
      .select({ title: schema.knowledgeDocs.title, kbId: schema.knowledgeDocs.kbId })
      .from(schema.knowledgeDocs)
      .where(
        and(
          eq(schema.knowledgeDocs.id, did),
          eq(schema.knowledgeDocs.workspaceId, ws.workspace.id)
        )
      )
      .limit(1)
  )[0];
  const deleted = await db
    .delete(schema.knowledgeDocs)
    .where(
      and(
        eq(schema.knowledgeDocs.id, did),
        eq(schema.knowledgeDocs.workspaceId, ws.workspace.id)
      )
    )
    .returning({ id: schema.knowledgeDocs.id });
  if (!deleted[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit({
    workspaceId: ws.workspace.id,
    userId: session.user.id,
    action: "kb.doc.delete",
    resource: "knowledge_doc",
    resourceId: did,
    before: before ? { title: before.title, kbId: before.kbId } : undefined,
  });
  return NextResponse.json({ ok: true });
}
