import "server-only";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { decrypt } from "./encryption";
import { routeToProvider, type ProviderType } from "./providers";

export interface ToolDefinitionForLlm {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolUseBlock {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: ToolUseBlock[];
  toolResults?: ToolResultBlock[];
}

export interface LlmCallParams {
  workspaceId: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinitionForLlm[];
}

export interface LlmCallResult {
  content: string;
  tokensUsed: number;
  model: string;
  toolCalls?: ToolUseBlock[];
}

export class ProviderNotConfiguredError extends Error {
  constructor(public provider: ProviderType) {
    super(`Provider ${provider} is not configured`);
    this.name = "ProviderNotConfiguredError";
  }
}

async function getProviderKey(workspaceId: string, provider: ProviderType) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aiProviders)
    .where(
      and(
        eq(schema.aiProviders.workspaceId, workspaceId),
        eq(schema.aiProviders.provider, provider)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row || !row.enabled) throw new ProviderNotConfiguredError(provider);
  return { apiKey: decrypt(row.apiKey), endpoint: row.endpoint };
}

export async function llmCall(p: LlmCallParams): Promise<LlmCallResult> {
  const provider = routeToProvider(p.model);
  if (!provider) throw new Error(`Unknown model: ${p.model}`);
  const { apiKey, endpoint } = await getProviderKey(p.workspaceId, provider);

  if (provider === "anthropic") return callAnthropic(p, apiKey);
  if (provider === "openai") return callOpenAI(p, apiKey);
  if (provider === "google") return callGoogle(p, apiKey);
  if (provider === "azure_openai") return callAzure(p, apiKey, endpoint);
  throw new Error(`Provider ${provider} not implemented`);
}

async function callAnthropic(p: LlmCallParams, apiKey: string): Promise<LlmCallResult> {
  // Build messages, encoding tool calls and tool results in Anthropic's content-block format
  const anthropicMessages = p.messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
        // Tool result(s) — sent as user role with tool_result content blocks
        const blocks = (m.toolResults ?? []).map((tr) => ({
          type: "tool_result" as const,
          tool_use_id: tr.id,
          content: tr.error
            ? `Error: ${tr.error}`
            : typeof tr.output === "string"
            ? tr.output
            : JSON.stringify(tr.output ?? null),
          ...(tr.error ? { is_error: true } : {}),
        }));
        return { role: "user" as const, content: blocks };
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const blocks: Array<Record<string, unknown>> = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls) {
          blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
        }
        return { role: "assistant" as const, content: blocks };
      }
      return { role: m.role, content: m.content };
    });

  const body: Record<string, unknown> = {
    model: p.model,
    max_tokens: p.maxTokens ?? 1024,
    temperature: p.temperature ?? 0.7,
    system: p.systemPrompt,
    messages: anthropicMessages,
  };

  if (p.tools && p.tools.length > 0) {
    body.tools = p.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const j = await r.json();

  // Extract text + tool_use blocks from response content
  const blocks = (j.content ?? []) as Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  const toolCalls: ToolUseBlock[] = blocks
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: b.id ?? "", name: b.name ?? "", input: b.input ?? {} }));

  const result: LlmCallResult = {
    content: text,
    tokensUsed: (j.usage?.input_tokens ?? 0) + (j.usage?.output_tokens ?? 0),
    model: p.model,
  };
  if (toolCalls.length > 0) result.toolCalls = toolCalls;
  return result;
}

async function callOpenAI(p: LlmCallParams, apiKey: string): Promise<LlmCallResult> {
  // Strip non-text fields for OpenAI (tool-calling not supported in this iteration)
  const messages = p.messages
    .filter((m) => m.role !== "tool")
    .map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content }));
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: p.model,
      messages: [{ role: "system", content: p.systemPrompt }, ...messages],
      temperature: p.temperature ?? 0.7,
      max_tokens: p.maxTokens ?? 1024,
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return {
    content: j.choices?.[0]?.message?.content ?? "",
    tokensUsed: j.usage?.total_tokens ?? 0,
    model: p.model,
  };
}

async function callGoogle(p: LlmCallParams, apiKey: string): Promise<LlmCallResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    p.model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: p.systemPrompt }] },
      contents: p.messages
        .filter((m) => m.role !== "tool" && m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
      generationConfig: {
        temperature: p.temperature ?? 0.7,
        maxOutputTokens: p.maxTokens ?? 1024,
      },
    }),
  });
  if (!r.ok) throw new Error(`Google ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const content = j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return {
    content,
    tokensUsed:
      (j.usageMetadata?.promptTokenCount ?? 0) + (j.usageMetadata?.candidatesTokenCount ?? 0),
    model: p.model,
  };
}

async function callAzure(
  p: LlmCallParams,
  apiKey: string,
  endpoint: string | null
): Promise<LlmCallResult> {
  if (!endpoint) throw new Error("Azure endpoint not configured");
  const deployment = p.model.replace(/^azure\//, "");
  const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-01`;
  const messages = p.messages
    .filter((m) => m.role !== "tool")
    .map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content }));
  const r = await fetch(url, {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "system", content: p.systemPrompt }, ...messages],
      temperature: p.temperature ?? 0.7,
      max_tokens: p.maxTokens ?? 1024,
    }),
  });
  if (!r.ok) throw new Error(`Azure ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return {
    content: j.choices?.[0]?.message?.content ?? "",
    tokensUsed: j.usage?.total_tokens ?? 0,
    model: p.model,
  };
}

/** Pick the best available provider for one-shot tasks (prompt generation). */
export async function pickAvailableModel(
  workspaceId: string
): Promise<{ provider: ProviderType; model: string } | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aiProviders)
    .where(eq(schema.aiProviders.workspaceId, workspaceId));
  const order: ProviderType[] = ["anthropic", "openai", "google", "azure_openai"];
  for (const p of order) {
    const row = rows.find((r) => r.provider === p && r.enabled);
    if (!row) continue;
    if (p === "anthropic") return { provider: p, model: "claude-sonnet-4-6" };
    if (p === "openai") return { provider: p, model: "gpt-4o-mini" };
    if (p === "google") return { provider: p, model: "gemini-1.5-flash" };
    if (p === "azure_openai" && row.modelsJson?.[0])
      return { provider: p, model: row.modelsJson[0].id };
  }
  return null;
}
