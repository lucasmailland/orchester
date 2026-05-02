import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; did: string }> }
) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { did } = await params;
  const db = getDb();
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
  return NextResponse.json({ ok: true });
}
