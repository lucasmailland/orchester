import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const [d] = await db
    .delete(schema.aiProviders)
    .where(and(eq(schema.aiProviders.id, id), eq(schema.aiProviders.workspaceId, ws.workspace.id)))
    .returning({ id: schema.aiProviders.id });
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
