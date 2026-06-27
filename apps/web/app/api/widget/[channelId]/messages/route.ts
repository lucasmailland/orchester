import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@orchester/db";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { handleInbound } from "@/lib/channels/router";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { rateLimit } from "@/lib/rate-limit";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

// Endpoint público con CORS: validamos forma pero devolvemos los errores con
// los CORS_HEADERS, por eso no usamos el helper parseBody acá.
const widgetMessageSchema = z.object({
  visitorId: z.string().optional(),
  text: z.string().optional(),
  customerName: z.string().optional(),
  customerEmail: z.string().optional(),
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const raw = await req.json().catch(() => ({}));
  const result0 = widgetMessageSchema.safeParse(raw);
  if (!result0.success) {
    return NextResponse.json(
      { error: "Validación fallida", issues: result0.error.issues.map((i) => i.message) },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  const body = result0.data;
  const visitorId = String(body?.visitorId ?? "").trim();
  const text = String(body?.text ?? "").trim();
  if (!visitorId || !text) {
    return NextResponse.json(
      { error: "visitorId and text required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Lookup channel + workspaceId. The widget URL is keyed by
  // channel id and we don't know the workspace until after we
  // resolve the channel — so this single lookup runs through
  // `withCrossTenantAdmin` (RLS bypass, audit-logged). The
  // subsequent `handleInbound` is the library's responsibility
  // for tenant-scoping its own queries.
  const channel = await withCrossTenantAdmin("widget.channel_lookup", async (tx) => {
    const rows = await tx
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .limit(1);
    return rows[0];
  });
  if (!channel || (channel.type !== "widget" && channel.type !== "web")) {
    return NextResponse.json(
      { error: "Channel not found" },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  const rl = await rateLimit(`widget-in:${channel.id}`, { capacity: 60, refillPerSec: 1 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limited" },
      {
        status: 429,
        headers: {
          ...CORS_HEADERS,
          "retry-after": String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)),
        },
      }
    );
  }

  try {
    const result = await handleInbound(channel.workspaceId, {
      channelId: channel.id,
      externalId: visitorId,
      text,
      ...(body?.customerName ? { customerName: body.customerName } : {}),
      ...(body?.customerEmail ? { customerEmail: body.customerEmail } : {}),
      metadata: { source: "widget" },
    });
    return NextResponse.json(
      { conversationId: result.conversationId, reply: result.reply },
      { headers: CORS_HEADERS }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const url = new URL(req.url);
  const visitorId = String(url.searchParams.get("visitorId") ?? "").trim();
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (!visitorId) {
    return NextResponse.json(
      { error: "visitorId required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const result = await withCrossTenantAdmin("widget.transcript", async (tx) => {
    const chRows = await tx
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .limit(1);
    const channel = chRows[0];
    if (!channel || (channel.type !== "widget" && channel.type !== "web")) return null;

    const convRows = await tx
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, channel.workspaceId),
          eq(schema.conversations.channelId, channel.id),
          eq(schema.conversations.externalId, visitorId)
        )
      )
      .orderBy(desc(schema.conversations.createdAt))
      .limit(1);
    const conv = convRows[0];
    if (!conv) return { messages: [], conversationId: null as string | null };

    const rows = await tx
      .select({
        role: schema.messages.role,
        content: schema.messages.content,
        fromOperator: schema.messages.fromOperator,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(
        since
          ? and(eq(schema.messages.conversationId, conv.id), gt(schema.messages.createdAt, since))
          : eq(schema.messages.conversationId, conv.id)
      )
      .orderBy(asc(schema.messages.createdAt));
    return { messages: rows, conversationId: conv.id };
  });

  if (result === null) {
    return NextResponse.json(
      { error: "Channel not found" },
      { status: 404, headers: CORS_HEADERS }
    );
  }
  return NextResponse.json(result, { headers: CORS_HEADERS });
}
