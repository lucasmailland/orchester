import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.flows)
    .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ws.workspace.id)))
    .limit(1);
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const { name, description, status, trigger, triggerConfig, nodes, edges, variables, enabled } =
    body;
  const db = getDb();
  const updated = await db
    .update(schema.flows)
    .set({
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description }),
      ...(status !== undefined && { status }),
      ...(trigger !== undefined && { trigger }),
      ...(triggerConfig !== undefined && { triggerConfig }),
      ...(nodes !== undefined && { nodes }),
      ...(edges !== undefined && { edges }),
      ...(variables !== undefined && { variables }),
      ...(enabled !== undefined && { enabled }),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ws.workspace.id)))
    .returning();
  const row = updated[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const deleted = await db
    .delete(schema.flows)
    .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ws.workspace.id)))
    .returning({ id: schema.flows.id });
  if (!deleted[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
