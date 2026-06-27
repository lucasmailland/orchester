import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@orchester/db";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { parseBody } from "@/lib/validation";
import { deliver, type WebhookEvent } from "@/lib/webhooks-out";

export async function retryDelivery(
  workspaceId: string,
  webhookId: string,
  deliveryId: string
): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);

    const whRows = await tx
      .select()
      .from(schema.outboundWebhooks)
      .where(
        and(
          eq(schema.outboundWebhooks.id, webhookId),
          eq(schema.outboundWebhooks.workspaceId, workspaceId)
        )
      )
      .limit(1);
    const wh = whRows[0];
    if (!wh) return { ok: false, error: "Webhook not found" };

    const delRows = await tx
      .select()
      .from(schema.webhookDeliveries)
      .where(
        and(
          eq(schema.webhookDeliveries.id, deliveryId),
          eq(schema.webhookDeliveries.webhookId, webhookId),
          eq(schema.webhookDeliveries.workspaceId, workspaceId)
        )
      )
      .limit(1);
    const del = delRows[0];
    if (!del) return { ok: false, error: "Delivery not found" };

    if (!wh.enabled) {
      await tx
        .update(schema.outboundWebhooks)
        .set({ enabled: true, failureCount: 0 })
        .where(eq(schema.outboundWebhooks.id, webhookId));
    }

    await deliver(
      { ...wh, failureCount: 0 },
      del.event as WebhookEvent,
      (del.payload ?? {}) as Record<string, unknown>,
      tx
    );
    return { ok: true };
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; deliveryId: string }> }
) {
  const parsed = await parseBody(req, z.object({}));
  if (!parsed.ok) return parsed.response;
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id, deliveryId } = await params;
  const out = await retryDelivery(ctx.workspace.id, id, deliveryId);
  if (out.ok) {
    await logAudit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: "webhook.delivery_retry",
      resource: "webhook_delivery",
      resourceId: deliveryId,
    });
  }
  return NextResponse.json(out, { status: out.ok ? 200 : 404 });
}
