import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
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
    .from(schema.agentVersions)
    .where(
      and(
        eq(schema.agentVersions.agentId, id),
        eq(schema.agentVersions.workspaceId, ws.workspace.id)
      )
    )
    .orderBy(desc(schema.agentVersions.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const { systemPrompt, model, temperature, maxTokens, label } = body;
  if (!systemPrompt || !model)
    return NextResponse.json({ error: "systemPrompt and model required" }, { status: 400 });
  const db = getDb();
  const inserted = await db
    .insert(schema.agentVersions)
    .values({
      id: createId(),
      agentId: id,
      workspaceId: ws.workspace.id,
      systemPrompt,
      model,
      temperature: temperature !== undefined ? String(temperature) : null,
      maxTokens: maxTokens ?? null,
      label: label ?? null,
    })
    .returning();
  const v = inserted[0];
  if (!v) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json(v, { status: 201 });
}
