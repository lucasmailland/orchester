import "server-only";
import { createId } from "@paralleldrive/cuid2";
import crypto from "node:crypto";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";

export type WebhookEvent =
  | "agent.responded"
  | "flow.run.succeeded"
  | "flow.run.failed"
  | "conversation.escalated"
  | "conversation.created"
  | "kb.doc.indexed";

/**
 * Dispatch an event to all configured outbound webhooks for the workspace.
 * Records a delivery row for each subscriber. Fire-and-forget (non-blocking).
 */
export async function dispatchEvent(
  workspaceId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const db = getDb();
    const subs = await db
      .select()
      .from(schema.outboundWebhooks)
      .where(
        and(
          eq(schema.outboundWebhooks.workspaceId, workspaceId),
          eq(schema.outboundWebhooks.enabled, true)
        )
      );
    const targets = subs.filter((s) => (s.events ?? []).includes(event));
    await Promise.all(targets.map((s) => deliver(s, event, payload)));
  } catch (e) {
    const { safeLogError } = await import("./safe-log");
    safeLogError("[webhooks-out] dispatch failed:", e);
  }
}

async function deliver(
  sub: { id: string; workspaceId: string; url: string; secret: string },
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  const db = getDb();
  const deliveryId = createId();
  await db.insert(schema.webhookDeliveries).values({
    id: deliveryId,
    webhookId: sub.id,
    workspaceId: sub.workspaceId,
    event,
    payload,
    status: "pending",
  });

  const body = JSON.stringify({ event, data: payload, ts: Date.now() });
  const signature = crypto.createHmac("sha256", sub.secret).update(body).digest("hex");

  let attemptCount = 0;
  const maxAttempts = 3;
  let lastError: string | null = null;
  let lastStatus: number | null = null;
  let success = false;
  for (attemptCount = 1; attemptCount <= maxAttempts; attemptCount++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 8000);
      const r = await fetch(sub.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-orchester-signature": signature,
          "x-orchester-event": event,
        },
        body,
        signal: ac.signal,
      });
      clearTimeout(t);
      lastStatus = r.status;
      if (r.ok) {
        success = true;
        break;
      }
      lastError = `HTTP ${r.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attemptCount < maxAttempts) {
      await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attemptCount - 1)));
    }
  }

  await db
    .update(schema.webhookDeliveries)
    .set({
      status: success ? "succeeded" : "failed",
      responseStatus: lastStatus,
      error: success ? null : lastError,
      attemptCount,
      deliveredAt: new Date(),
    })
    .where(eq(schema.webhookDeliveries.id, deliveryId));

  await db
    .update(schema.outboundWebhooks)
    .set(
      success
        ? { lastDeliveredAt: new Date(), failureCount: 0 }
        : { lastErrorAt: new Date(), lastError, failureCount: (lastError ? 1 : 0) }
    )
    .where(eq(schema.outboundWebhooks.id, sub.id));
}
