import "server-only";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { decrypt } from "./encryption";
import { routeToProvider, type ProviderType } from "./providers";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LlmCallParams {
  workspaceId: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmCallResult {
  content: string;
  tokensUsed: number;
  model: string;
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
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: p.maxTokens ?? 1024,
      temperature: p.temperature ?? 0.7,
      system: p.systemPrompt,
      messages: p.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const content = j.content?.[0]?.text ?? "";
  return {
    content,
    tokensUsed: (j.usage?.input_tokens ?? 0) + (j.usage?.output_tokens ?? 0),
    model: p.model,
  };
}

async function callOpenAI(p: LlmCallParams, apiKey: string): Promise<LlmCallResult> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: p.model,
      messages: [{ role: "system", content: p.systemPrompt }, ...p.messages],
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
      contents: p.messages.map((m) => ({
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
  const r = await fetch(url, {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "system", content: p.systemPrompt }, ...p.messages],
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
