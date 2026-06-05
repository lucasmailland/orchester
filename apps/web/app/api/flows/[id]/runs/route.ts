import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.flowRuns)
    .where(and(eq(schema.flowRuns.flowId, id), eq(schema.flowRuns.workspaceId, ws.workspace.id)))
    .orderBy(desc(schema.flowRuns.startedAt))
    .limit(50);
  return NextResponse.json(rows);
}
