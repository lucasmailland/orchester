import { NextResponse } from "next/server";
import { schema } from "@orchester/db";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { handleInbound } from "@/lib/channels/router";
import {
  enforceWidgetRateLimit,
  parseWidgetMessage,
  WIDGET_CORS_HEADERS,
} from "@/lib/channels/widget-guard";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { safeLogError } from "@/lib/safe-log";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: WIDGET_CORS_HEADERS });
}

export async function POST(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;

  // Public, anonymous and LLM-bound: throttle before any other work.
  const limited = await enforceWidgetRateLimit(channelId, req.headers);
  if (limited) return limited;

  const parsed = await parseWidgetMessage(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.message;

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
  if (
    !channel ||
    (channel.type !== "widget" && channel.type !== "web") ||
    channel.status !== "active"
  ) {
    return NextResponse.json(
      { error: "Channel not found" },
      { status: 404, headers: WIDGET_CORS_HEADERS }
    );
  }

  try {
    const result = await handleInbound(channel.workspaceId, {
      channelId: channel.id,
      externalId: body.visitorId,
      text: body.text,
      ...(body.customerName ? { customerName: body.customerName } : {}),
      ...(body.customerEmail ? { customerEmail: body.customerEmail } : {}),
      metadata: { source: "widget" },
    });
    return NextResponse.json(
      { conversationId: result.conversationId, reply: result.reply },
      { headers: WIDGET_CORS_HEADERS }
    );
  } catch (e) {
    // The visitor is anonymous: internal error text stays in the server log.
    safeLogError("[widget-messages]", e);
    return NextResponse.json(
      { error: "The message could not be processed" },
      { status: 500, headers: WIDGET_CORS_HEADERS }
    );
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;

  // Public and anonymous, like POST: throttle before touching the database.
  const limited = await enforceWidgetRateLimit(channelId, req.headers, "transcript");
  if (limited) return limited;
  const url = new URL(req.url);
  const visitorId = String(url.searchParams.get("visitorId") ?? "").trim();
  const sinceRaw = url.searchParams.get("since");
  const sinceDate = sinceRaw ? new Date(sinceRaw) : null;
  const since = sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : null;
  if (!visitorId) {
    return NextResponse.json(
      { error: "visitorId required" },
      { status: 400, headers: WIDGET_CORS_HEADERS }
    );
  }

  const result = await withCrossTenantAdmin("widget.transcript", async (tx) => {
    const chRows = await tx
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .limit(1);
    const channel = chRows[0];
    if (
      !channel ||
      (channel.type !== "widget" && channel.type !== "web") ||
      channel.status !== "active"
    )
      return null;

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
        and(
          eq(schema.messages.conversationId, conv.id),
          // The visitor sees the conversation, not the system notes (handoffs, agent ids).
          inArray(schema.messages.role, ["user", "assistant"]),
          ...(since ? [gt(schema.messages.createdAt, since)] : [])
        )
      )
      .orderBy(asc(schema.messages.createdAt));
    return { messages: rows, conversationId: conv.id };
  });

  if (result === null) {
    return NextResponse.json(
      { error: "Channel not found" },
      { status: 404, headers: WIDGET_CORS_HEADERS }
    );
  }
  return NextResponse.json(result, { headers: WIDGET_CORS_HEADERS });
}
