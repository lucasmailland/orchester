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
import { executeFlow } from "@/lib/flow-engine";

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

  // Read body once
  const rawBody = await req.text();

  // Optional HMAC verification
  if (wh.hmacKey) {
    const sig = req.headers.get("x-orchester-signature") ?? "";
    const expected = crypto.createHmac("sha256", wh.hmacKey).update(rawBody).digest("hex");
    if (sig !== expected) {
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

  const input = {
    ...(typeof parsed === "object" && parsed !== null ? parsed : { body: parsed }),
    _query: query,
    _headers: Object.fromEntries(req.headers),
  };

  // Update counters (fire and forget)
  db.update(schema.flowWebhooks)
    .set({ lastTriggeredAt: new Date(), triggerCount: sql`${schema.flowWebhooks.triggerCount} + 1` })
    .where(eq(schema.flowWebhooks.id, wh.id))
    .catch(() => {});

  const result = await executeFlow({
    flowId: wh.flowId,
    workspaceId: wh.workspaceId,
    triggerSource: "webhook",
    input,
  });
  return NextResponse.json(result);
}
