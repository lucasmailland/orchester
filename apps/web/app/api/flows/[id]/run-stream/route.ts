import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { executeFlow, type FlowRunEvent } from "@/lib/flow-engine";

// `input` es JSON arbitrario definido por el trigger del flujo: no se restringe.
const runStreamSchema = z.object({
  input: z.unknown().optional(),
});

export const dynamic = "force-dynamic";

/**
 * POST /api/flows/[id]/run-stream
 * Ejecuta el flujo y emite eventos SSE en vivo (run_start, step_start,
 * step_finish, run_finish) para visualizar el progreso en el lienzo.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, runStreamSchema);
  if (!parsed.ok) return parsed.response;
  const input = (parsed.data.input ?? {}) as Record<string, unknown>;

  const encoder = new TextEncoder();
  // L5: cuando el cliente se desconecta dejamos de emitir eventos. (El flow
  // engine no expone un signal de cancelación, así que sólo cortamos el push
  // de eventos SSE; no abortamos la ejecución del flujo en sí.)
  const abort = new AbortController();
  if (req.signal.aborted) abort.abort();
  else req.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (ev: FlowRunEvent) => {
        if (closed || abort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          /* stream cerrado */
        }
      };
      try {
        await executeFlow({
          flowId: id,
          workspaceId: ctx.workspace.id,
          triggerSource: "manual",
          input,
          onEvent: send,
        });
      } catch (e) {
        send({ type: "run_finish", status: "failed", error: e instanceof Error ? e.message : String(e) });
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
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
