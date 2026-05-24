import { NextResponse } from "next/server";
import { schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { handleInboundStream } from "@/lib/channels/router";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { safeLogError } from "@/lib/safe-log";

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
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const body = await req.json().catch(() => ({}));
  const visitorId = String(body?.visitorId ?? "").trim();
  const text = String(body?.text ?? "").trim();
  if (!visitorId || !text) {
    return NextResponse.json(
      { error: "visitorId and text required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

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
  if (!channel || (channel.type !== "widget" && channel.type !== "web")) {
    return NextResponse.json(
      { error: "Channel not found" },
      { status: 404, headers: CORS_HEADERS }
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
            customerName: body?.customerName ?? undefined,
            customerEmail: body?.customerEmail ?? undefined,
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
          send({ type: "error", error: e instanceof Error ? e.message : String(e) });
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
      ...CORS_HEADERS,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
