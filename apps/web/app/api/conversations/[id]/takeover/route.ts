import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  const session = await getCurrentSession();
  if (!ws || !session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const updated = await db
    .update(schema.conversations)
    .set({ takenOverAt: new Date(), assignedToUserId: session.user.id, status: "escalated" })
    .where(
      and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ws.workspace.id))
    )
    .returning();
  return NextResponse.json(updated[0] ?? null);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const updated = await db
    .update(schema.conversations)
    .set({ takenOverAt: null, assignedToUserId: null, status: "open" })
    .where(
      and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ws.workspace.id))
    )
    .returning();
  return NextResponse.json(updated[0] ?? null);
}
