import "server-only";
import { createId } from "@paralleldrive/cuid2";
import crypto from "node:crypto";
import { getDb, schema } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";

export type WebhookEvent =
  | "agent.responded"
  | "agent.created"
  | "flow.run.succeeded"
  | "flow.run.failed"
  | "conversation.created"
  | "conversation.closed"
  | "conversation.escalated"
  | "conversation.csat"
  | "message.received"
  | "kb.doc.indexed"
  | "integration.connected"
  | "employee.budget.warn70"
  | "employee.budget.warn90"
  | "employee.budget.exceeded";

/** Catálogo de eventos suscribibles, con descripción para la UI. */
export const WEBHOOK_EVENTS: { event: WebhookEvent; description: string }[] = [
  { event: "agent.responded", description: "Un agente respondió un mensaje." },
  { event: "agent.created", description: "Se creó un agente nuevo." },
  { event: "flow.run.succeeded", description: "Una corrida de flujo terminó OK." },
  { event: "flow.run.failed", description: "Una corrida de flujo falló." },
  { event: "conversation.created", description: "Se inició una conversación nueva." },
  { event: "conversation.closed", description: "Se cerró una conversación." },
  { event: "conversation.escalated", description: "Una conversación se escaló a humano." },
  { event: "conversation.csat", description: "Se registró un puntaje CSAT." },
  { event: "message.received", description: "Llegó un mensaje entrante de un cliente." },
  { event: "kb.doc.indexed", description: "Se indexó un documento en una knowledge base." },
  { event: "integration.connected", description: "Se conectó una integración." },
  { event: "employee.budget.warn70", description: "Un empleado llegó al 70% de su budget." },
  { event: "employee.budget.warn90", description: "Un empleado llegó al 90% de su budget." },
  { event: "employee.budget.exceeded", description: "Un empleado excedió su budget." },
];

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

/**
 * Envía un evento de prueba (`webhook.test`) a UN webhook puntual y registra la
 * entrega. Usado por el botón "Probar" de la UI para verificar la URL + firma.
 */
export async function sendTestEvent(
  workspaceId: string,
  webhookId: string
): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.outboundWebhooks)
    .where(
      and(
        eq(schema.outboundWebhooks.id, webhookId),
        eq(schema.outboundWebhooks.workspaceId, workspaceId)
      )
    )
    .limit(1);
  const wh = rows[0];
  if (!wh) return { ok: false, error: "Webhook no encontrado" };
  try {
    await deliver(wh, "agent.responded", {
      _test: true,
      message: "Evento de prueba desde Orchester. Si lo recibís, tu webhook está OK.",
      ts: Date.now(),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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

  // Guard SSRF: no entregar a hosts internos aunque la URL haya quedado guardada.
  try {
    const { assertPublicUrl } = await import("./net-guard");
    assertPublicUrl(sub.url);
  } catch (e) {
    await db
      .update(schema.webhookDeliveries)
      .set({ status: "failed", error: e instanceof Error ? e.message : "URL bloqueada", deliveredAt: new Date() })
      .where(eq(schema.webhookDeliveries.id, deliveryId));
    return;
  }

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
      // Exponential backoff con jitter (Decorrelated Jitter de AWS).
      // Evita thundering herd cuando muchos webhooks fallan simultáneamente.
      const base = 500;
      const cap = 30_000;
      const exp = Math.min(cap, base * Math.pow(2, attemptCount - 1));
      const jittered = Math.random() * (exp - base) + base;
      await new Promise((res) => setTimeout(res, jittered));
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
        : {
            lastErrorAt: new Date(),
            lastError,
            // Incremento real de fallas consecutivas (antes quedaba siempre en 1).
            failureCount: sql`${schema.outboundWebhooks.failureCount} + 1`,
          }
    )
    .where(eq(schema.outboundWebhooks.id, sub.id));
}
