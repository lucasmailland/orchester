import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { ProviderNotConfiguredError } from "@/lib/llm-call";
import { runAgent, loadAgent } from "@/lib/agent-runtime";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { parseBody } from "@/lib/validation";

const testChatSchema = z.object({
  messages: z.array(
    z.object({ role: z.enum(["user", "assistant"]), content: z.string() })
  ),
  systemPrompt: z.string(),
  model: z.string(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  tools: z.array(z.string()).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // F-2: gate de rol — la studio quema créditos reales de LLM, no la abrimos a viewer.
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const ws = { workspace: ctx.workspace };
  const session = { user: ctx.user };

  // LLM-heavy endpoint: 30 req/min por (workspace,user). Defensa contra
  // un user comprometido que quiera quemar la cuota de Anthropic.
  const limited = await enforceRateLimit(
    `test-chat:${ws.workspace.id}:${session.user.id}`,
    RATE_LIMITS.LLM_HEAVY
  );
  if (limited) return limited;

  const { id } = await params;
  const parsed = await parseBody(req, testChatSchema);
  if (!parsed.ok) return parsed.response;
  const {
    messages,
    systemPrompt,
    model,
    temperature,
    maxTokens,
    variables,
    tools,
  } = parsed.data;
  if (!messages?.length || !systemPrompt || !model)
    return NextResponse.json(
      { error: "messages, systemPrompt, model required" },
      { status: 400 }
    );

  const agent = await loadAgent(ws.workspace.id, id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  try {
    const overrides: NonNullable<Parameters<typeof runAgent>[0]["overrides"]> = {
      systemPrompt,
      model,
    };
    if (temperature !== undefined) overrides.temperature = temperature;
    if (maxTokens !== undefined) overrides.maxTokens = maxTokens;
    if (variables !== undefined) overrides.variables = variables;
    if (tools !== undefined) overrides.tools = tools;

    const r = await runAgent({
      workspaceId: ws.workspace.id,
      agent: {
        id: agent.id,
        kind: agent.kind,
        flowId: agent.flowId,
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        variables: agent.variables,
        tools: agent.tools,
        responseFormat: agent.responseFormat,
        maxTurns: agent.maxTurns,
      },
      messages,
      overrides,
    });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError)
      return NextResponse.json(
        { error: "PROVIDER_NOT_CONFIGURED", provider: e.provider },
        { status: 401 }
      );
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
