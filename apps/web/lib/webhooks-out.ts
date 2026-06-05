import "server-only";
import { createId } from "@paralleldrive/cuid2";
import crypto from "node:crypto";
import { getDb, schema, type DbClient } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";

/**
 * Optional `tx?: WsDb` follows the project-wide pattern (see
 * `lib/billing/quotas.ts`). When a caller is already inside a
 * workspace transaction (cost-alerts, integrations/store, channel
 * worker), passing tx keeps the `outboundWebhooks` SELECT and the
 * delivery-row INSERT/UPDATE on the same connection so FORCE RLS
 * sees `app.workspace_id` SET LOCAL.
 *
 * Best-effort semantics are preserved: any error is logged, not
 * thrown.
 */
type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

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
  payload: Record<string, unknown>,
  tx?: WsDb
): Promise<void> {
  try {
    const db = tx ?? getDb();
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
    await Promise.all(targets.map((s) => deliver(s, event, payload, tx)));
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

/**
 * Tras N fallos consecutivos (env `WEBHOOK_MAX_FAILURES`, default 15) se
 * deshabilita el subscriber (enabled=false) para no seguir martillando un
 * endpoint muerto. El contador se resetea a 0 en cada éxito.
 */
const WEBHOOK_MAX_FAILURES = Math.max(1, Number(process.env.WEBHOOK_MAX_FAILURES) || 15);

async function deliver(
  sub: { id: string; workspaceId: string; url: string; secret: string; failureCount?: number },
  event: WebhookEvent,
  payload: Record<string, unknown>,
  tx?: WsDb
): Promise<void> {
  const db = tx ?? getDb();
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
      .set({
        status: "failed",
        error: e instanceof Error ? e.message : "URL bloqueada",
        deliveredAt: new Date(),
      })
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

  if (success) {
    await db
      .update(schema.outboundWebhooks)
      // Reset del contador de fallas consecutivas en cada éxito.
      .set({ lastDeliveredAt: new Date(), failureCount: 0 })
      .where(eq(schema.outboundWebhooks.id, sub.id));
    return;
  }

  // Fallo: incremento real de fallas consecutivas. `sub.failureCount` viene del
  // SELECT previo (estado antes de este intento); el nuevo conteo es +1.
  const newFailureCount = (sub.failureCount ?? 0) + 1;
  const shouldDisable = newFailureCount >= WEBHOOK_MAX_FAILURES;
  await db
    .update(schema.outboundWebhooks)
    .set({
      lastErrorAt: new Date(),
      lastError,
      failureCount: sql`${schema.outboundWebhooks.failureCount} + 1`,
      // Auto-disable (C6): tras N fallos consecutivos apagamos el subscriber.
      ...(shouldDisable ? { enabled: false } : {}),
    })
    .where(eq(schema.outboundWebhooks.id, sub.id));

  if (shouldDisable) {
    const { safeLogError } = await import("./safe-log");
    safeLogError(
      `[webhooks-out] subscriber ${sub.id} deshabilitado tras ${newFailureCount} fallos consecutivos (>= WEBHOOK_MAX_FAILURES=${WEBHOOK_MAX_FAILURES}).`,
      lastError
    );
  }
}
