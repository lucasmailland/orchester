import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { ProviderNotConfiguredError } from "@/lib/llm-call";
import { runAgent, loadAgent } from "@/lib/agent-runtime";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const {
    messages,
    systemPrompt,
    model,
    temperature,
    maxTokens,
    variables,
    tools,
  } = body as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    systemPrompt: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    variables?: Record<string, string>;
    tools?: string[];
  };
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
