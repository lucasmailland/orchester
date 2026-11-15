import "server-only";
import { getDb, schema } from "@orchester/db";
import { and, eq, sql } from "drizzle-orm";
import { deliver, type WebhookEvent } from "@/lib/webhooks-out";

/**
 * Re-deliver a failed webhook delivery, re-enabling the webhook if it was
 * auto-disabled. Extracted from the route so tests can call it directly without
 * triggering Next.js route-file export constraints.
 */
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
