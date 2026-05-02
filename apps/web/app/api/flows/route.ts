import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, or, desc } from "drizzle-orm";
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
  const { name, description, templateId } = body;
  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  const db = getDb();

  // Optional: load template
  let initialNodes: unknown[] = [];
  let initialEdges: unknown[] = [];
  let initialVars: Record<string, unknown> = {};
  if (templateId) {
    const tpls = await db
      .select()
      .from(schema.flowTemplates)
      .where(
        and(
          eq(schema.flowTemplates.id, templateId),
          or(
            eq(schema.flowTemplates.isPublic, true),
            eq(schema.flowTemplates.workspaceId, ws.workspace.id)
          )
        )
      )
      .limit(1);
    const t = tpls[0];
    if (!t) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    initialNodes = (t.nodes as unknown[]) ?? [];
    initialEdges = (t.edges as unknown[]) ?? [];
    initialVars = (t.variables as Record<string, unknown>) ?? {};
  }

  // Empty starter: a single trigger node
  if (initialNodes.length === 0) {
    const triggerNodeId = createId();
    initialNodes = [
      {
        id: triggerNodeId,
        type: "trigger",
        label: "Inicio",
        config: { trigger: "manual" },
        position: { x: 100, y: 100 },
      },
    ];
  }

  const inserted = await db
    .insert(schema.flows)
    .values({
      id: createId(),
      workspaceId: ws.workspace.id,
      name: name.trim(),
      description: description ?? null,
      nodes: initialNodes as never,
      edges: initialEdges as never,
      variables: initialVars,
    })
    .returning();
  const row = inserted[0];
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}
