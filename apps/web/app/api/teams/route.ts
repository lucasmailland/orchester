import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function POST(req: Request) {
  const workspace = await getCurrentWorkspace();
  if (!workspace) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, description, avatarColor } = body;

  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const db = getDb();
  const [team] = await db
    .insert(schema.teams)
    .values({
      id: createId(),
      workspaceId: workspace.workspace.id,
      name: name.trim(),
      description: description?.trim() || null,
      avatarColor: avatarColor || "#7C3AED",
    })
    .returning();

  return NextResponse.json(team, { status: 201 });
}
