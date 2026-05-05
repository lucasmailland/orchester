import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const convs = await db
    .select()
    .from(schema.conversations)
    .where(
      and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ws.workspace.id))
    )
    .limit(1);
  const conv = convs[0];
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const messages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, id))
    .orderBy(schema.messages.createdAt);
  return NextResponse.json({ conversation: conv, messages });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  const set: Record<string, unknown> = {};
  if (body.status !== undefined) set.status = body.status;
  if (body.tags !== undefined) set.tags = body.tags;
  if (body.csat !== undefined) set.csat = body.csat;
  if (body.summary !== undefined) set.summary = body.summary;
  if (body.assignedToUserId !== undefined) set.assignedToUserId = body.assignedToUserId;
  const updated = await db
    .update(schema.conversations)
    .set(set)
    .where(
      and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ws.workspace.id))
    )
    .returning();
  const row = updated[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
