import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, asc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.conversationLabels)
    .where(eq(schema.conversationLabels.workspaceId, ws.workspace.id))
    .orderBy(asc(schema.conversationLabels.name));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  if (!body?.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  const db = getDb();
  const inserted = await db
    .insert(schema.conversationLabels)
    .values({
      id: createId(),
      workspaceId: ws.workspace.id,
      name: body.name.trim(),
      color: body.color ?? "#8b5cf6",
    })
    .returning();
  return NextResponse.json(inserted[0]!, { status: 201 });
}
