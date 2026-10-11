import { NextResponse } from "next/server";
import { schema } from "@orchester/db";
import { eq } from "drizzle-orm";
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
