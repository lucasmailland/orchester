import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getCurrentWorkspace } from "@/lib/workspace";
import { llmCall, pickAvailableModel, type ChatMessage } from "@/lib/llm-call";
import {
  COPILOT_TOOLS,
  buildSystemPrompt,
  buildGraphFromSpec,
  type FlowSpec,
} from "@/lib/flows/copilot-tools";

/**
 * POST /api/flows/[id]/copilot
 * Body: { prompt: string, apiUrl?: string, history?: {role,content}[] }
 * Devuelve: { message, graph?: { nodes, edges }, errors }
 *
 * El copiloto arma el flujo llamando a la tool set_flow. Lo construimos y lo
 * devolvemos para que el cliente lo aplique al lienzo.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await params; // flowId no se usa para construir, pero valida la ruta

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt ?? "").trim();
  const apiUrl = body?.apiUrl ? String(body.apiUrl).trim() : "";
  if (!prompt) return NextResponse.json({ error: "Contanos qué querés que haga el flujo." }, { status: 400 });

  const picked = await pickAvailableModel(ws.workspace.id);
  if (!picked) {
    return NextResponse.json(
      { error: "Primero conectá un proveedor de IA en Ajustes para usar el copiloto." },
      { status: 400 }
    );
  }

  const history: ChatMessage[] = Array.isArray(body?.history)
    ? body.history
        .filter((m: unknown): m is { role: string; content: string } =>
          !!m && typeof (m as { content?: unknown }).content === "string"
        )
        .slice(-8)
        .map((m: { role: string; content: string }) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }))
    : [];

  const userContent = apiUrl ? `${prompt}\n\nURL de la API: ${apiUrl}` : prompt;
  const messages: ChatMessage[] = [...history, { role: "user", content: userContent }];

  let result;
  try {
    result = await llmCall({
      workspaceId: ws.workspace.id,
      model: picked.model,
      systemPrompt: buildSystemPrompt("es"),
      messages,
      temperature: 0.2,
      maxTokens: 2048,
      tools: COPILOT_TOOLS,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "El copiloto no pudo responder." },
      { status: 502 }
    );
  }

  const setFlow = result.toolCalls?.find((t) => t.name === "set_flow");
  if (!setFlow) {
    return NextResponse.json({ message: result.content || "¿Podés darme más detalles?", graph: null, errors: [] });
  }

  const spec = setFlow.input as FlowSpec;
  const built = buildGraphFromSpec(
    { nodes: spec?.nodes ?? [], edges: spec?.edges ?? [] },
    () => createId()
  );

  return NextResponse.json({
    message: result.content || "Listo, armé el flujo. Revisalo y ajustá lo que quieras.",
    graph: { nodes: built.nodes, edges: built.edges },
    errors: built.errors,
  });
}
