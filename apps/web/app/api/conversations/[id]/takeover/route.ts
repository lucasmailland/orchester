import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  const updated = await db
    .update(schema.conversations)
    .set({ takenOverAt: new Date(), assignedToUserId: ctx.user.id, status: "escalated" })
    .where(
      and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ctx.workspace.id))
    )
    .returning();
  if (updated[0]) {
    await logAudit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: "conversation.takeover",
      resource: "conversation",
      resourceId: id,
    });
  }
  return NextResponse.json(updated[0] ?? null);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  const updated = await db
    .update(schema.conversations)
    .set({ takenOverAt: null, assignedToUserId: null, status: "open" })
    .where(
      and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ctx.workspace.id))
    )
    .returning();
  if (updated[0]) {
    await logAudit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: "conversation.takeover_release",
      resource: "conversation",
      resourceId: id,
    });
  }
  return NextResponse.json(updated[0] ?? null);
}
