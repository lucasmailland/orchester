/**
 * Public webhook endpoint — anyone with the secret URL can trigger a flow.
 *
 *   POST /api/webhooks/{secret}
 *   GET  /api/webhooks/{secret}   (also triggers — useful for cron-like services)
 *
 * Body (POST) is passed as `input` to the flow. Query params are merged in too.
 * If the webhook has an HMAC key, the request must include `X-Orchester-Signature`
 * header with the hex SHA-256 HMAC of the raw body.
 */
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getDb, schema } from "@orchester/db";
import { eq, sql } from "drizzle-orm";
import { enqueueFlowRun } from "@/lib/flow-engine";
import { rateLimit } from "@/lib/rate-limit";

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
  return handle(req, await params);
}

async function handle(req: Request, p: { secret: string }) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.flowWebhooks)
    .where(eq(schema.flowWebhooks.secret, p.secret))
    .limit(1);
  const wh = rows[0];
  if (!wh || !wh.enabled) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  // Rate limit por secret: el endpoint es público y dispara un flow completo
  // (con llamadas LLM) por request → sin límite es DoS / amplificación de costo.
  const rl = await rateLimit(`webhook-in:${p.secret}`, { capacity: 60, refillPerSec: 1 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "retry-after": String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)) } }
    );
  }

  // Body con cap de tamaño (1 MB) para evitar payloads abusivos.
  const rawBody = await req.text();
  if (rawBody.length > 1_000_000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  // HMAC opcional con comparación timing-safe (evita oráculo de timing).
  if (wh.hmacKey) {
    const sig = req.headers.get("x-orchester-signature") ?? "";
    const expected = crypto.createHmac("sha256", wh.hmacKey).update(rawBody).digest("hex");
    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
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

  // Update counters (fire and forget)
  db.update(schema.flowWebhooks)
    .set({ lastTriggeredAt: new Date(), triggerCount: sql`${schema.flowWebhooks.triggerCount} + 1` })
    .where(eq(schema.flowWebhooks.id, wh.id))
    .catch(() => {});

  // Encolamos la ejecución (async) en vez de correrla inline: un webhook no debe
  // mantener abierta la conexión HTTP mientras el flow hace polling de video/IA.
  const result = await enqueueFlowRun({
    flowId: wh.flowId,
    workspaceId: wh.workspaceId,
    triggerSource: "webhook",
    input,
  });
  return NextResponse.json(result, { status: 202 });
}
