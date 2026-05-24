import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

const updateFlowWebhookSchema = z.object({
  enabled: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; wid: string }> }
) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { wid } = await params;
  const parsed = await parseBody(req, updateFlowWebhookSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const db = getDb();
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    const updated = await tx
      .update(schema.flowWebhooks)
      .set({ ...(body.enabled !== undefined && { enabled: !!body.enabled }) })
      .where(
        and(eq(schema.flowWebhooks.id, wid), eq(schema.flowWebhooks.workspaceId, ctx.workspace.id))
      )
      .returning();
    return updated[0];
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; wid: string }> }
) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { wid } = await params;
  const db = getDb();
  const deletedId = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    const deleted = await tx
      .delete(schema.flowWebhooks)
      .where(
        and(eq(schema.flowWebhooks.id, wid), eq(schema.flowWebhooks.workspaceId, ctx.workspace.id))
      )
      .returning({ id: schema.flowWebhooks.id });
    return deleted[0]?.id ?? null;
  });
  if (!deletedId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
