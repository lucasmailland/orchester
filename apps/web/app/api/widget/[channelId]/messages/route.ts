import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { handleInbound } from "@/lib/channels/router";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
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

  // Lookup channel + workspaceId
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .limit(1);
  const channel = rows[0];
  if (!channel || (channel.type !== "widget" && channel.type !== "web")) {
    return NextResponse.json(
      { error: "Channel not found" },
      { status: 404, headers: CORS_HEADERS }
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
