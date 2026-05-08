import { NextResponse } from "next/server";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";
import { ProviderNotConfiguredError, llmStream } from "@/lib/llm-call";
import { loadAgent } from "@/lib/agent-runtime";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { safeLogError } from "@/lib/safe-log";

/** Inline interpolation: reemplaza {{var}} en el prompt con `vars[var]`. */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

/**
 * POST /api/agents/[id]/test-chat-stream
 *
 * SSE endpoint que streamea la respuesta del agente token-por-token.
 *
 * Body: igual que test-chat (messages, systemPrompt, model, ...)
 *
 * Response: text/event-stream con eventos:
 *   data: {"type":"text","delta":"..."}
 *   data: {"type":"done","tokensUsed":123,"model":"..."}
 *   data: {"type":"error","error":"..."}
 *
 * El cliente consume con un `EventSource` o un `fetch + getReader` parser.
 * Tools NO se ejecutan en este endpoint — es solo para el "test chat" del
 * studio donde queremos ver cómo responde el LLM puro. Para tools usá el
 * endpoint blocking (test-chat) o el flow-engine.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  const ws = await getCurrentWorkspace();
  if (!ws || !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit(
    `test-chat-stream:${ws.workspace.id}:${session.user.id}`,
    RATE_LIMITS.LLM_HEAVY
  );
  if (limited) return limited;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { messages, systemPrompt, model, temperature, maxTokens, variables } = body as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    systemPrompt: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    variables?: Record<string, string>;
  };
  if (!messages?.length || !systemPrompt || !model) {
    return NextResponse.json(
      { error: "messages, systemPrompt, model required" },
      { status: 400 }
    );
  }

  const agent = await loadAgent(ws.workspace.id, id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const finalSystem = interpolate(
    systemPrompt,
    variables ?? (agent.variables as Record<string, string> | null) ?? {}
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };
      try {
        for await (const chunk of llmStream({
          workspaceId: ws.workspace.id,
          model,
          systemPrompt: finalSystem,
          messages,
          ...(temperature !== undefined ? { temperature } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
        })) {
          send(chunk);
        }
      } catch (e) {
        if (e instanceof ProviderNotConfiguredError) {
          send({ type: "error", error: `Provider ${e.provider} not configured` });
        } else {
          safeLogError("[test-chat-stream]", e);
          send({ type: "error", error: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
