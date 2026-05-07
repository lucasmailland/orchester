import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";
import { logAudit } from "@/lib/audit";

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
  if (updated[0]) {
    await logAudit({
      workspaceId: ws.workspace.id,
      userId: session.user.id,
      action: "conversation.takeover",
      resource: "conversation",
      resourceId: id,
    });
  }
  return NextResponse.json(updated[0] ?? null);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  const session = await getCurrentSession();
  if (!ws || !session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const updated = await db
    .update(schema.conversations)
    .set({ takenOverAt: null, assignedToUserId: null, status: "open" })
    .where(
      and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ws.workspace.id))
    )
    .returning();
  if (updated[0]) {
    await logAudit({
      workspaceId: ws.workspace.id,
      userId: session.user.id,
      action: "conversation.takeover_release",
      resource: "conversation",
      resourceId: id,
    });
  }
  return NextResponse.json(updated[0] ?? null);
}
