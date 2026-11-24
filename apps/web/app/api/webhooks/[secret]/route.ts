/**
 * Public webhook endpoint — anyone with the secret URL can trigger a flow.
 *
 *   POST /api/webhooks/{secret}
 *   GET  -> 405 (a secret URL in logs/referrers must not fire a flow);
 *           FLOW_WEBHOOK_ALLOW_GET=1 restores the old behaviour.
 *
 * Body (POST) is passed as `input` to the flow. Query params are merged in too.
 * If the webhook has an HMAC key, the request must include
 * `X-Orchester-Signature: t=<unix>,v1=<hex>` (see lib/flows/webhook-signature.ts);
 * the timestamp expires after 300 s. FLOW_WEBHOOK_LEGACY_SIGNATURE=1 still
 * accepts the old body-only hex HMAC while callers migrate.
 */
import { NextResponse } from "next/server";
import { schema } from "@orchester/db";
import { eq, sql } from "drizzle-orm";
import { enqueueFlowRun } from "@/lib/flow-engine";
import { FlowDisabledError } from "@/lib/flows/run-gate";
import { checkFlowWebhookSignature } from "@/lib/flows/webhook-signature";
import { logWithContext } from "@/lib/observability";
import { rateLimit } from "@/lib/rate-limit";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";

/** Headers seguros para pasar al flow (evita filtrar Authorization/Cookie). */
const SAFE_HEADERS = new Set([
  "content-type",
  "user-agent",
  "x-orchester-event",
  "x-github-event",
  "x-event-key",
  "x-request-id",
]);

export async function POST(req: Request, { params }: { params: Promise<{ secret: string }> }) {
  return handle(req, await params);
}
export async function GET(req: Request, { params }: { params: Promise<{ secret: string }> }) {
  if (process.env.FLOW_WEBHOOK_ALLOW_GET !== "1") {
    return NextResponse.json(
      { error: "Method not allowed" },
      { status: 405, headers: { allow: "POST" } }
    );
  }
  return handle(req, await params);
}

async function handle(req: Request, p: { secret: string }) {
  // Inbound webhook is unauthenticated (the secret in the URL IS the
  // credential). The flow_webhook lookup runs without a workspace GUC, so
  // FORCE RLS would block the SELECT — wrap in cross-tenant admin. We
  // resolve the row inside the bypass and pull workspaceId out so the
  // downstream flow enqueue can run with the proper context.
  const wh = await withCrossTenantAdmin("webhook.inbound", async (tx) => {
    const rows = await tx
      .select()
      .from(schema.flowWebhooks)
      .where(eq(schema.flowWebhooks.secret, p.secret))
      .limit(1);
    return rows[0] ?? null;
  });
  if (!wh || !wh.enabled) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  // Rate limit por secret: el endpoint es público y dispara un flow completo
  // (con llamadas LLM) por request → sin límite es DoS / amplificación de costo.
  const rl = await rateLimit(`webhook-in:${p.secret}`, { capacity: 60, refillPerSec: 1 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limited" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)) },
      }
    );
  }

  // Body con cap de tamaño (1 MB) para evitar payloads abusivos.
  const rawBody = await req.text();
  if (rawBody.length > 1_000_000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  // HMAC opcional: firma con timestamp (vence a los 300 s) que cubre query y body.
  if (wh.hmacKey) {
    const check = checkFlowWebhookSignature(
      wh.hmacKey,
      req.headers.get("x-orchester-signature"),
      new URL(req.url).search,
      rawBody
    );
    const legacyOk = check === "legacy" && process.env.FLOW_WEBHOOK_LEGACY_SIGNATURE === "1";
    if (check !== "ok" && !legacyOk) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    if (legacyOk) {
      logWithContext("warn", "flow webhook accepted with legacy body-only signature", {
        webhookId: wh.id,
      });
    }
  }

  let parsed: unknown = {};
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    parsed = { raw: rawBody };
  }
  const url = new URL(req.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  // Sólo headers seguros (no Authorization/Cookie/etc.).
  const safeHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (SAFE_HEADERS.has(k.toLowerCase())) safeHeaders[k] = v;
  });

  const input = {
    ...(typeof parsed === "object" && parsed !== null ? parsed : { body: parsed }),
    _query: query,
    _headers: safeHeaders,
  };

  // Encolamos la ejecución (async) en vez de correrla inline: un webhook no debe
  // mantener abierta la conexión HTTP mientras el flow hace polling de video/IA.
  // The flow itself may be switched off even though this webhook row is
  // enabled: refuse before any run row exists.
  let result;
  try {
    result = await enqueueFlowRun({
      flowId: wh.flowId,
      workspaceId: wh.workspaceId,
      triggerSource: "webhook",
      input,
    });
  } catch (e) {
    if (e instanceof FlowDisabledError) {
      return NextResponse.json({ error: "flow is disabled" }, { status: 409 });
    }
    throw e;
  }

  // Update counters (fire and forget). Also FORCE RLS — bypass for the
  // bookkeeping update.
  void withCrossTenantAdmin("webhook.inbound", async (tx) => {
    await tx
      .update(schema.flowWebhooks)
      .set({
        lastTriggeredAt: new Date(),
        triggerCount: sql`${schema.flowWebhooks.triggerCount} + 1`,
      })
      .where(eq(schema.flowWebhooks.id, wh.id));
  }).catch(() => {});

  return NextResponse.json(result, { status: 202 });
}
