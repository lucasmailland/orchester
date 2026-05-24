import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { sendTestEvent } from "@/lib/webhooks-out";

const testWebhookSchema = z.object({ action: z.literal("test") });
const updateWebhookSchema = z.object({
  url: z.string().optional(),
  events: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

/** POST /api/webhooks-out/[id]  { action: "test" } → entrega un evento de prueba. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, testWebhookSchema);
  if (!parsed.ok) return parsed.response;
  const result = await sendTestEvent(ctx.workspace.id, id);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, updateWebhookSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const db = getDb();
  const set: Record<string, unknown> = {};
  if (body.url !== undefined) {
    try {
      const { assertPublicUrl } = await import("@/lib/net-guard");
      assertPublicUrl(String(body.url));
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "URL invalida" },
        { status: 400 }
      );
    }
    set.url = body.url;
  }
  if (body.events !== undefined) set.events = body.events;
  if (body.enabled !== undefined) set.enabled = !!body.enabled;
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    return tx
      .update(schema.outboundWebhooks)
      .set(set)
      .where(
        and(
          eq(schema.outboundWebhooks.id, id),
          eq(schema.outboundWebhooks.workspaceId, ctx.workspace.id)
        )
      )
      .returning();
  });
  if (!updated[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated[0]);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  const deleted = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    return tx
      .delete(schema.outboundWebhooks)
      .where(
        and(
          eq(schema.outboundWebhooks.id, id),
          eq(schema.outboundWebhooks.workspaceId, ctx.workspace.id)
        )
      )
      .returning({ id: schema.outboundWebhooks.id });
  });
  if (!deleted[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "webhook.delete",
    resource: "outbound_webhook",
    resourceId: id,
  });
  return NextResponse.json({ ok: true });
}
