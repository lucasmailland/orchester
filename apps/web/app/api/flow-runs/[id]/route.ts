import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const runs = await db
    .select()
    .from(schema.flowRuns)
    .where(and(eq(schema.flowRuns.id, id), eq(schema.flowRuns.workspaceId, ws.workspace.id)))
    .limit(1);
  const run = runs[0];
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const steps = await db
    .select()
    .from(schema.flowRunSteps)
    .where(eq(schema.flowRunSteps.runId, id))
    .orderBy(schema.flowRunSteps.startedAt);
  return NextResponse.json({ run, steps });
}
