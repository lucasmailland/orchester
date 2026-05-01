import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.flows)
    .where(eq(schema.flows.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.flows.updatedAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { name, description } = body;
  if (!name?.trim())
    return NextResponse.json({ error: "name required" }, { status: 400 });
  const db = getDb();
  const triggerNodeId = createId();
  const inserted = await db
    .insert(schema.flows)
    .values({
      id: createId(),
      workspaceId: ws.workspace.id,
      name: name.trim(),
      description: description ?? null,
      nodes: [
        {
          id: triggerNodeId,
          type: "trigger",
          label: "Inicio",
          config: { trigger: "manual" },
          position: { x: 100, y: 100 },
        },
      ],
      edges: [],
    })
    .returning();
  const row = inserted[0];
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}
