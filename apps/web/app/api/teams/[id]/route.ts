import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const workspace = await getCurrentWorkspace();
  if (!workspace) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { name, description, avatarColor } = body;

  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const db = getDb();
  const [team] = await db
    .update(schema.teams)
    .set({
      name: name.trim(),
      description: description?.trim() || null,
      avatarColor: avatarColor || "#7C3AED",
      updatedAt: new Date(),
    })
    .where(and(eq(schema.teams.id, id), eq(schema.teams.workspaceId, workspace.workspace.id)))
    .returning();

  if (!team) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(team);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const workspace = await getCurrentWorkspace();
  if (!workspace) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const [deleted] = await db
    .delete(schema.teams)
    .where(and(eq(schema.teams.id, id), eq(schema.teams.workspaceId, workspace.workspace.id)))
    .returning({ id: schema.teams.id });

  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
