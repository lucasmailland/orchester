import "server-only";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { llmCall, type ChatMessage } from "./llm-call";
import { executeTool, getToolDefinitions, type ToolCall } from "./tools";

/**
 * Single entry point that runs an agent for a chat turn.
 * Routes:
 *   - kind="flow"          → executes the linked flow with input.lastMessage
 *   - kind="conversational"→ llmCall with system prompt, vars interpolated, optional tools
 */
export interface RunAgentParams {
  workspaceId: string;
  agent: {
    id: string;
    kind: "conversational" | "flow";
    flowId: string | null;
    systemPrompt: string;
    model: string;
    temperature: string | null;
    maxTokens: number | null;
    variables: Record<string, string> | null;
    tools: string[] | null;
    responseFormat: "text" | "json" | "markdown";
    maxTurns: number | null;
  };
  messages: ChatMessage[];
  /** Override for the live test chat where the user is editing the prompt unsaved. */
  overrides?: {
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    variables?: Record<string, string>;
    tools?: string[];
  };
  /** Optional context — enables memory_* tools to scope per-conversation/employee. */
  conversationId?: string;
  employeeId?: string;
}

export interface RunAgentResult {
  content: string;
  tokensUsed: number;
  model: string;
  toolCalls?: Array<{ name: string; input: unknown; output: unknown; error?: string }>;
  flowRunId?: string;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, k: string) => vars[k.trim()] ?? "");
}

export async function runAgent(p: RunAgentParams): Promise<RunAgentResult> {
  const o = p.overrides ?? {};
  const systemPrompt = o.systemPrompt ?? p.agent.systemPrompt;
  const model = o.model ?? p.agent.model;
  const temperature = o.temperature ?? (p.agent.temperature ? Number(p.agent.temperature) : 0.7);
  const maxTokens = o.maxTokens ?? p.agent.maxTokens ?? undefined;
  const variables = o.variables ?? p.agent.variables ?? {};
  const enabledTools = o.tools ?? p.agent.tools ?? [];

  // Flow-driven agent
  if (p.agent.kind === "flow" && p.agent.flowId) {
    const lastUser = [...p.messages].reverse().find((m) => m.role === "user");
    const { executeFlow } = await import("./flow-engine");
    const result = await executeFlow({
      flowId: p.agent.flowId,
      workspaceId: p.workspaceId,
      triggerSource: `agent:${p.agent.id}`,
      input: {
        message: lastUser?.content ?? "",
        history: p.messages,
        variables,
      },
    });
    if (result.status === "failed") {
      return {
        content: `_(El flujo falló: ${result.error ?? "error desconocido"})_`,
        tokensUsed: 0,
        model: "flow",
        flowRunId: result.runId,
      };
    }
    // Try to extract a `response` variable from the run output
    const db = getDb();
    const runs = await db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.id, result.runId))
      .limit(1);
    const out = runs[0]?.output as Record<string, unknown> | undefined;
    const content =
      typeof out?.response === "string"
        ? out.response
        : typeof out?.message === "string"
        ? out.message
        : "_(El flujo se ejecutó. Configurá una variable `response` o `message` para devolver texto.)_";
    return { content, tokensUsed: 0, model: "flow", flowRunId: result.runId };
  }

  // Conversational agent — interpolate variables into system prompt
  const interpolatedPrompt = interpolate(systemPrompt, variables);

  // Append response format hint for json/markdown
  let finalPrompt = interpolatedPrompt;
  if (p.agent.responseFormat === "json") {
    finalPrompt += "\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no commentary.";
  } else if (p.agent.responseFormat === "markdown") {
    finalPrompt += "\n\nFormat your response in Markdown.";
  }

  // Tool-calling loop (currently Anthropic only — others fall through to plain chat)
  const toolDefs = enabledTools.length > 0 ? getToolDefinitions(enabledTools) : [];
  const toolCalls: RunAgentResult["toolCalls"] = [];
  let messages = [...p.messages];
  let totalTokens = 0;
  const maxToolIterations = Math.min(5, p.agent.maxTurns ?? 5);

  for (let i = 0; i < maxToolIterations; i++) {
    const callOpts: Parameters<typeof llmCall>[0] = {
      workspaceId: p.workspaceId,
      model,
      systemPrompt: finalPrompt,
      messages,
      temperature,
      ...(maxTokens !== undefined && { maxTokens }),
    };
    if (toolDefs.length > 0) callOpts.tools = toolDefs;

    const r = await llmCall(callOpts);
    totalTokens += r.tokensUsed;

    // No tool calls or unsupported provider → return immediately
    if (!r.toolCalls || r.toolCalls.length === 0) {
      return { content: r.content, tokensUsed: totalTokens, model: r.model, toolCalls };
    }

    // Execute tool calls
    const toolResults: ToolCall[] = [];
    for (const tc of r.toolCalls) {
      try {
        const out = await executeTool(tc.name, tc.input as Record<string, unknown>, {
          workspaceId: p.workspaceId,
          variables,
          agentId: p.agent.id,
          ...(p.conversationId ? { conversationId: p.conversationId } : {}),
          ...(p.employeeId ? { employeeId: p.employeeId } : {}),
        });
        toolCalls.push({ name: tc.name, input: tc.input, output: out });
        toolResults.push({ id: tc.id, name: tc.name, input: tc.input, output: out });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        toolCalls.push({ name: tc.name, input: tc.input, output: null, error: err });
        toolResults.push({ id: tc.id, name: tc.name, input: tc.input, error: err });
      }
    }

    // Loop with tool results appended
    messages = [
      ...messages,
      { role: "assistant", content: r.content, toolCalls: r.toolCalls },
      { role: "tool", content: "", toolResults },
    ];
  }

  return {
    content: "_(Loop de herramientas excedió el máximo de iteraciones)_",
    tokensUsed: totalTokens,
    model,
    toolCalls,
  };
}

/** Load agent from DB. */
export async function loadAgent(workspaceId: string, agentId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}
