import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { llmCall, pickAvailableModel, type ChatMessage } from "@/lib/llm-call";
import { assertWithinSpend } from "@/lib/cost-alerts";
import { recordAiUsage } from "@/lib/ai/run";
import { calculateChatCostUsd } from "@/lib/pricing";

const copilotSchema = z.object({
  prompt: z.string().optional(),
  apiUrl: z.string().optional(),
  // history y currentGraph son estructuras dinámicas validadas más abajo.
  history: z.array(z.unknown()).optional(),
  currentGraph: z.record(z.string(), z.unknown()).optional(),
});
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
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  await params; // flowId no se usa para construir, pero valida la ruta

  const parsed = await parseBody(req, copilotSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const prompt = String(body?.prompt ?? "").trim();
  const apiUrl = body?.apiUrl ? String(body.apiUrl).trim() : "";
  if (!prompt)
    return NextResponse.json({ error: "Contanos qué querés que haga el flujo." }, { status: 400 });

  const picked = await pickAvailableModel(ctx.workspace.id);
  if (!picked) {
    return NextResponse.json(
      { error: "Primero conectá un proveedor de IA en Ajustes para usar el copiloto." },
      { status: 400 }
    );
  }

  const history: ChatMessage[] = Array.isArray(body?.history)
    ? body.history
        .filter(
          (m: unknown): m is { role: string; content: string } =>
            !!m && typeof (m as { content?: unknown }).content === "string"
        )
        .slice(-8)
        .map((m: { role: string; content: string }) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }))
    : [];

  // Si ya hay un flujo, se lo damos al copiloto para que lo MODIFIQUE en lugar
  // de armar uno de cero. Debe devolver el flujo completo actualizado.
  const current = body?.currentGraph;
  const hasCurrent = current && Array.isArray(current.nodes) && current.nodes.length > 0;

  const parts = [prompt];
  if (apiUrl) parts.push(`URL de la API: ${apiUrl}`);
  if (hasCurrent) {
    parts.push(
      "El flujo actual (en JSON) es el siguiente. Modificalo según lo que te pido y " +
        "devolvé el flujo COMPLETO y actualizado con set_flow (incluí los pasos que se mantienen, " +
        "conservando sus mismos id):\n" +
        JSON.stringify(current)
    );
  }
  const userContent = parts.join("\n\n");
  const messages: ChatMessage[] = [...history, { role: "user", content: userContent }];

  let result;
  try {
    await assertWithinSpend(ctx.workspace.id);
    result = await llmCall({
      workspaceId: ctx.workspace.id,
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

  // E2-2: metering del copiloto.
  await recordAiUsage({
    workspaceId: ctx.workspace.id,
    capability: "chat",
    model: result.model,
    tokensOut: result.tokensUsed,
    tokensTotal: result.tokensUsed,
    costUsd: calculateChatCostUsd(result.model, 0, result.tokensUsed),
  });

  const setFlow = result.toolCalls?.find((t) => t.name === "set_flow");
  if (!setFlow) {
    return NextResponse.json({
      message: result.content || "¿Podés darme más detalles?",
      graph: null,
      errors: [],
    });
  }

  const spec = setFlow.input as FlowSpec;
  const built = buildGraphFromSpec({ nodes: spec?.nodes ?? [], edges: spec?.edges ?? [] }, () =>
    createId()
  );

  return NextResponse.json({
    message: result.content || "Listo, armé el flujo. Revisalo y ajustá lo que quieras.",
    graph: { nodes: built.nodes, edges: built.edges },
    errors: built.errors,
  });
}
