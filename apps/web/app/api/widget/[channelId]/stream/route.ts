import { NextResponse } from "next/server";
import { schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { handleInboundStream } from "@/lib/channels/router";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { safeLogError } from "@/lib/safe-log";
import {
  enforceWidgetRateLimit,
  parseWidgetMessage,
  WIDGET_CORS_HEADERS,
} from "@/lib/channels/widget-guard";

/**
 * POST /api/widget/[channelId]/stream
 *
 * Variante SSE del endpoint del widget público. Streamea la respuesta del
 * agente token-por-token. Reusa el MISMO pipeline que el endpoint bloqueante
 * (handleInboundStream → resolveInbound + persistAssistantTurn), así que la
 * persistencia (mensajes, costos, usage) es idéntica.
 *
 * Eventos:
 *   data: {"type":"text","delta":"..."}
 *   data: {"type":"done","conversationId":"...","reply":"...","tokensUsed":N}
 *   data: {"type":"error","error":"..."}
 */
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
  const { visitorId, text, customerName, customerEmail } = parsed.message;

  // Channel lookup is the only tenant-scoped query owned by the
  // route — `handleInboundStream` manages its own queries. The
  // widget URL doesn't reveal the workspace, so this lookup runs
  // through the cross-tenant bypass (audit-logged).
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

  const encoder = new TextEncoder();
  // L5: cancelar el consumo del LLM upstream cuando el cliente se desconecta.
  const abort = new AbortController();
  if (req.signal.aborted) abort.abort();
  else req.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (chunk: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };
      try {
        for await (const chunk of handleInboundStream(
          channel.workspaceId,
          {
            channelId: channel.id,
            externalId: visitorId,
            text,
            ...(customerName ? { customerName } : {}),
            ...(customerEmail ? { customerEmail } : {}),
            metadata: { source: "widget" },
          },
          abort.signal
        )) {
          if (abort.signal.aborted) break;
          send(chunk);
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          safeLogError("[widget-stream]", e);
          // The visitor is anonymous: internal error text stays in the server log.
          send({ type: "error", error: "The message could not be processed" });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      }
    },
    // Disparado cuando el consumidor (cliente) cancela el stream.
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      ...WIDGET_CORS_HEADERS,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
