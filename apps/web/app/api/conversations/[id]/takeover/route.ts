import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { dispatchEvent } from "@/lib/webhooks-out";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    return tx
      .update(schema.conversations)
      .set({ takenOverAt: new Date(), assignedToUserId: ctx.user.id, status: "escalated" })
      .where(
        and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ctx.workspace.id))
      )
      .returning();
  });
  if (updated[0]) {
    await logAudit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: "conversation.takeover",
      resource: "conversation",
      resourceId: id,
    });
    void dispatchEvent(ctx.workspace.id, "conversation.escalated", {
      conversationId: id,
      assignedToUserId: ctx.user.id,
    });
    void import("@/lib/notifications/triggers").then((m) =>
      m.notifyEscalation(ctx.workspace.id, { conversationId: id })
    );
  }
  return NextResponse.json(updated[0] ?? null);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    return tx
      .update(schema.conversations)
      .set({ takenOverAt: null, assignedToUserId: null, status: "open" })
      .where(
        and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ctx.workspace.id))
      )
      .returning();
  });
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
