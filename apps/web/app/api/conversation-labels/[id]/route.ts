import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const deleted = await db
    .delete(schema.conversationLabels)
    .where(
      and(
        eq(schema.conversationLabels.id, id),
        eq(schema.conversationLabels.workspaceId, ws.workspace.id)
      )
    )
    .returning({ id: schema.conversationLabels.id });
  if (!deleted[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
