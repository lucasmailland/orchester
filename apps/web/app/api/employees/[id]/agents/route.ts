import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const { agentIds } = body as { agentIds: string[] };
  if (!Array.isArray(agentIds))
    return NextResponse.json({ error: "agentIds[] required" }, { status: 400 });
  const db = getDb();
  const updated = await db
    .update(schema.employees)
    .set({ assignedAgentIds: agentIds, updatedAt: new Date() })
    .where(and(eq(schema.employees.id, id), eq(schema.employees.workspaceId, ws.workspace.id)))
    .returning();
  const row = updated[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
