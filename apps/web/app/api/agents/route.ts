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
    .from(schema.agents)
    .where(eq(schema.agents.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.agents.updatedAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const workspace = await getCurrentWorkspace();
  if (!workspace) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, role, systemPrompt, model, status, teamId } = body;

  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!role?.trim()) return NextResponse.json({ error: "Role is required" }, { status: 400 });
  if (!systemPrompt?.trim()) return NextResponse.json({ error: "System prompt is required" }, { status: 400 });

  const db = getDb();
  const [agent] = await db
    .insert(schema.agents)
    .values({
      id: createId(),
      workspaceId: workspace.workspace.id,
      teamId: teamId || null,
      name: name.trim(),
      role: role.trim(),
      systemPrompt: systemPrompt.trim(),
      model: model || "claude-sonnet-4-6",
      status: status || "draft",
    })
    .returning();

  return NextResponse.json(agent, { status: 201 });
}
