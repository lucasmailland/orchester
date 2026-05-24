import "server-only";
import { getDb, schema, type DbClient } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { decrypt } from "./encryption";
import { type ProviderType } from "./providers";
import { resolveModel } from "./ai/catalog";
import { fetchWithTimeout, fetchStreamWithConnectTimeout, withRetry, HttpError } from "./http-util";
import { recordMetric, logWithContext } from "./observability";
import type {
  ChatMessage as CapChatMessage,
  ToolUseBlock as CapToolUseBlock,
  ToolResultBlock as CapToolResultBlock,
} from "./ai/capabilities";

/**
 * Optional `tx?: WsDb` follows the project-wide pattern (see
 * `lib/billing/quotas.ts`). When the caller already runs inside a
 * workspace transaction (channels router, flow engine wrap), passing
 * tx keeps the `ai_provider` lookup on the same connection so FORCE
 * RLS sees `app.workspace_id` SET LOCAL.
 */
type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

// Tipos canónicos del port `chat` (capabilities.ts). Re-exportados acá para no
// romper a los 5 callers históricos que importan `ChatMessage` desde llm-call.
// A3: unificación de la duplicación previa de `ChatMessage`/`ToolUseBlock`/
// `ToolResultBlock` que vivía localmente en este archivo.
export type ChatMessage = CapChatMessage;
export type ToolUseBlock = CapToolUseBlock;
export type ToolResultBlock = CapToolResultBlock;

/** Timeout para obtener la respuesta completa de un LLM (block call). */
const LLM_TIMEOUT_MS = 120_000;
/**
 * Timeout para ESTABLECER la conexión de streaming. El `fetch` resuelve cuando
 * llegan los headers de respuesta; no abortamos mid-stream (el body se lee con
 * su propio reader). 120s para acomodar TTFB lento de modelos de razonamiento.
 */
const LLM_STREAM_CONNECT_TIMEOUT_MS = 120_000;

export interface ToolDefinitionForLlm {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmCallParams {
  workspaceId: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinitionForLlm[];
  /** Id de correlación opcional para atar logs/errores de esta llamada (D1). */
  correlationId?: string;
  /**
   * Signal de cancelación opcional (L5). Cuando el cliente de un endpoint SSE
   * se desconecta, su `req.signal` se aborta → en el path de streaming abortamos
   * el `fetch` upstream y cortamos la lectura del generador, así dejamos de
   * consumir (y facturar) tokens del LLM. En el path bloqueante se ignora.
   */
  signal?: AbortSignal;
  /**
   * Optional workspace transaction handle (R2-C). When the caller is already
   * inside a `withWorkspaceTx`, threading `tx` here makes the internal
   * `getProviderKey` SELECT run on the same connection that has
   * `app.workspace_id` SET LOCAL — otherwise FORCE RLS rejects the read.
   */
  tx?: WsDb;
}

export interface LlmCallResult {
  content: string;
  tokensUsed: number;
  model: string;
  toolCalls?: ToolUseBlock[];
}

/**
 * Stream chunk emitido por `llmStream()`. Discriminado por `type`:
 *   - `text`: porción de texto (concatená en orden)
 *   - `toolCall`: el modelo decidió llamar a una tool (se entrega completo,
 *     no en chunks parciales — Anthropic streamea tool calls al final)
 *   - `done`: streaming terminó. Trae el `tokensUsed` total.
 *   - `error`: algo falló mid-stream.
 */
export type LlmStreamChunk =
  | { type: "text"; delta: string }
  | { type: "toolCall"; toolCall: ToolUseBlock }
  | { type: "done"; tokensUsed: number; model: string }
  | { type: "error"; error: string };

export class ProviderNotConfiguredError extends Error {
  constructor(public provider: string) {
    super(`El proveedor "${provider}" no está conectado. Agregá su API key en Ajustes.`);
    this.name = "ProviderNotConfiguredError";
  }
}

async function getProviderKey(workspaceId: string, provider: string, tx?: WsDb) {
  const db = tx ?? getDb();
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
  const startedAt = Date.now();
  try {
    const res = await llmCallInner(p);
    // Latencia de la llamada de IA (D2) — scrapeable desde logs.
    recordMetric("ai.call.latency_ms", Date.now() - startedAt, {
      model: p.model,
      provider: providerOf(p.model),
    });
    return res;
  } catch (e) {
    // Log correlacionado del error (D1) sin romper el flujo de propagación.
    logWithContext("error", "[llm-call] llmCall failed", {
      ...(p.correlationId ? { correlationId: p.correlationId } : {}),
      model: p.model,
      error: e instanceof Error ? e.message : String(e),
    });
    recordMetric("ai.call.latency_ms", Date.now() - startedAt, {
      model: p.model,
      outcome: "error",
    });
    throw e;
  }
}

/** Devuelve el id del provider para taggear métricas; tolerante a modelos desconocidos. */
function providerOf(model: string): string {
  return resolveModel(model)?.provider.id ?? "unknown";
}

async function llmCallInner(p: LlmCallParams): Promise<LlmCallResult> {
  const resolved = resolveModel(p.model);
  if (!resolved || resolved.capability !== "chat")
    throw new Error(`No reconozco el modelo de chat "${p.model}".`);
  const { apiKey, endpoint } = await getProviderKey(p.workspaceId, resolved.provider.id, p.tx);
  const params = { ...p, model: resolved.model };

  if (resolved.provider.id === "azure_openai") return callAzure(params, apiKey, endpoint);
  switch (resolved.provider.family) {
    case "anthropic":
      return callAnthropic(params, apiKey);
    case "gemini":
      return callGoogle(params, apiKey);
    case "openai-compatible": {
      const baseURL = (endpoint?.replace(/\/$/, "") || resolved.provider.baseURL)!;
      return callOpenAICompatible(params, apiKey, baseURL);
    }
    default:
      throw new Error(`${resolved.provider.name} todavía no soporta chat.`);
  }
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

  const j = await withRetry(async () => {
    const r = await fetchWithTimeout(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      LLM_TIMEOUT_MS
    );
    if (!r.ok) throw new HttpError(r.status, `Anthropic ${r.status}: ${await r.text()}`);
    return r.json();
  });

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

/** Encode our ChatMessage[] into OpenAI Chat Completions format (with tools). */
function toOpenAIMessages(p: LlmCallParams) {
  const out: Array<Record<string, unknown>> = [{ role: "system", content: p.systemPrompt }];
  for (const m of p.messages) {
    if (m.role === "tool") {
      for (const tr of m.toolResults ?? []) {
        out.push({
          role: "tool",
          tool_call_id: tr.id,
          content: tr.error
            ? `Error: ${tr.error}`
            : typeof tr.output === "string"
              ? tr.output
              : JSON.stringify(tr.output ?? null),
        });
      }
      continue;
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
        })),
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

function toOpenAITools(tools?: ToolDefinitionForLlm[]) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

/** Modelos de razonamiento de OpenAI: usan max_completion_tokens y no aceptan temperature. */
function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/.test(model);
}

/** Arma el body de Chat Completions respetando las particularidades de los modelos. */
function buildOpenAIChatBody(
  p: LlmCallParams,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const reasoning = isReasoningModel(p.model);
  const body: Record<string, unknown> = {
    model: p.model,
    messages: toOpenAIMessages(p),
    ...(reasoning
      ? { max_completion_tokens: p.maxTokens ?? 1024 }
      : { max_tokens: p.maxTokens ?? 1024, temperature: p.temperature ?? 0.7 }),
    ...(extra ?? {}),
  };
  const tools = toOpenAITools(p.tools);
  if (tools) body.tools = tools;
  return body;
}

async function callOpenAICompatible(
  p: LlmCallParams,
  apiKey: string,
  baseURL: string
): Promise<LlmCallResult> {
  const body = buildOpenAIChatBody(p);
  const j = await withRetry(async () => {
    const r = await fetchWithTimeout(
      `${baseURL}/chat/completions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      LLM_TIMEOUT_MS
    );
    if (!r.ok) throw new HttpError(r.status, `Proveedor de chat ${r.status}: ${await r.text()}`);
    return r.json();
  });
  const msg = j.choices?.[0]?.message ?? {};
  const toolCalls: ToolUseBlock[] = (msg.tool_calls ?? []).map(
    (tc: { id: string; function: { name: string; arguments: string } }) => ({
      id: tc.id,
      name: tc.function?.name ?? "",
      input: safeJsonParse(tc.function?.arguments ?? "{}") ?? {},
    })
  );
  const result: LlmCallResult = {
    content: msg.content ?? "",
    tokensUsed: j.usage?.total_tokens ?? 0,
    model: p.model,
  };
  if (toolCalls.length > 0) result.toolCalls = toolCalls;
  return result;
}

async function callGoogle(p: LlmCallParams, apiKey: string): Promise<LlmCallResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    p.model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const j = await withRetry(async () => {
    const r = await fetchWithTimeout(
      url,
      {
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
      },
      LLM_TIMEOUT_MS
    );
    if (!r.ok) throw new HttpError(r.status, `Google ${r.status}: ${await r.text()}`);
    return r.json();
  });
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
  const j = await withRetry(async () => {
    const r = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "system", content: p.systemPrompt }, ...messages],
          temperature: p.temperature ?? 0.7,
          max_tokens: p.maxTokens ?? 1024,
        }),
      },
      LLM_TIMEOUT_MS
    );
    if (!r.ok) throw new HttpError(r.status, `Azure ${r.status}: ${await r.text()}`);
    return r.json();
  });
  return {
    content: j.choices?.[0]?.message?.content ?? "",
    tokensUsed: j.usage?.total_tokens ?? 0,
    model: p.model,
  };
}

/**
 * Streaming version de `llmCall()`. Devuelve un AsyncIterable que emite chunks
 * de texto a medida que el provider los manda. Implementaciones:
 *   - Anthropic: SSE con eventos `content_block_delta`/`message_delta`
 *   - OpenAI: SSE con `delta.content` parcial
 *   - Google + Azure: fall-through a llamada blocking + emit single chunk
 *     (no soportan streaming en este iteration)
 *
 * El caller consume con:
 *   for await (const chunk of llmStream(params)) {
 *     if (chunk.type === "text") buffer += chunk.delta;
 *     if (chunk.type === "done") finalTokens = chunk.tokensUsed;
 *   }
 */
export async function* llmStream(p: LlmCallParams): AsyncGenerator<LlmStreamChunk> {
  const resolved = resolveModel(p.model);
  if (!resolved || resolved.capability !== "chat") {
    yield { type: "error", error: `No reconozco el modelo de chat "${p.model}".` };
    return;
  }
  const { apiKey } = await getProviderKey(p.workspaceId, resolved.provider.id, p.tx);
  const params = { ...p, model: resolved.model };

  if (resolved.provider.id !== "azure_openai" && resolved.provider.family === "anthropic") {
    yield* streamAnthropic(params, apiKey);
    return;
  }
  if (resolved.provider.id !== "azure_openai" && resolved.provider.family === "openai-compatible") {
    yield* streamOpenAI(params, apiKey, resolved.provider.baseURL!);
    return;
  }
  // Gemini / Azure → fallback blocking, un solo chunk al final.
  try {
    const result = await llmCall(p);
    if (result.content) yield { type: "text", delta: result.content };
    if (result.toolCalls?.length) {
      for (const tc of result.toolCalls) yield { type: "toolCall", toolCall: tc };
    }
    yield { type: "done", tokensUsed: result.tokensUsed, model: result.model };
  } catch (e) {
    yield { type: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

async function* streamAnthropic(p: LlmCallParams, apiKey: string): AsyncGenerator<LlmStreamChunk> {
  // Build messages igual que el blocking call
  const anthropicMessages = p.messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
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
    stream: true,
  };
  if (p.tools && p.tools.length > 0) {
    body.tools = p.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  // Si el cliente ya se fue antes de arrancar, no abrimos la conexión.
  if (p.signal?.aborted) return;

  // Timeout sólo para establecer la conexión (TTFB). Una vez que llegan los
  // headers, el body se lee con su propio reader sin abortar mid-stream.
  // El `signal` del caller (L5) se pasa al fetch para abortar el upstream si el
  // cliente se desconecta; además se chequea al leer el body en `parseSSE`.
  const r = await fetchStreamWithConnectTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      ...(p.signal ? { signal: p.signal } : {}),
    },
    LLM_STREAM_CONNECT_TIMEOUT_MS
  );
  if (!r.ok || !r.body) {
    const txt = await r.text().catch(() => "");
    yield { type: "error", error: `Anthropic ${r.status}: ${txt}` };
    return;
  }

  // Estado para reconstruir tool_use blocks streameados.
  // Anthropic envía: content_block_start (con id+name) → input_json_delta → content_block_stop
  type ToolBuilder = { id: string; name: string; jsonStr: string };
  const toolByIndex: Record<number, ToolBuilder> = {};
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const ev of parseSSE(r.body, p.signal)) {
    if (ev.event === "message_start") {
      const data = safeJsonParse(ev.data);
      inputTokens = data?.message?.usage?.input_tokens ?? 0;
      continue;
    }
    if (ev.event === "content_block_start") {
      const data = safeJsonParse(ev.data);
      if (data?.content_block?.type === "tool_use") {
        toolByIndex[data.index] = {
          id: data.content_block.id,
          name: data.content_block.name,
          jsonStr: "",
        };
      }
      continue;
    }
    if (ev.event === "content_block_delta") {
      const data = safeJsonParse(ev.data);
      const d = data?.delta;
      if (d?.type === "text_delta" && typeof d.text === "string") {
        yield { type: "text", delta: d.text };
      } else if (d?.type === "input_json_delta" && typeof d.partial_json === "string") {
        const t = toolByIndex[data.index];
        if (t) t.jsonStr += d.partial_json;
      }
      continue;
    }
    if (ev.event === "content_block_stop") {
      const data = safeJsonParse(ev.data);
      const t = toolByIndex[data?.index];
      if (t) {
        let parsed: unknown = {};
        try {
          parsed = t.jsonStr ? JSON.parse(t.jsonStr) : {};
        } catch {
          /* leave {} */
        }
        yield { type: "toolCall", toolCall: { id: t.id, name: t.name, input: parsed } };
      }
      continue;
    }
    if (ev.event === "message_delta") {
      const data = safeJsonParse(ev.data);
      outputTokens = data?.usage?.output_tokens ?? outputTokens;
      continue;
    }
    if (ev.event === "message_stop") {
      yield { type: "done", tokensUsed: inputTokens + outputTokens, model: p.model };
      return;
    }
    if (ev.event === "error") {
      const data = safeJsonParse(ev.data);
      yield {
        type: "error",
        error: data?.error?.message ?? "stream error",
      };
      return;
    }
  }
  // Si llegamos acá sin message_stop, el stream se cortó.
  yield { type: "done", tokensUsed: inputTokens + outputTokens, model: p.model };
}

async function* streamOpenAI(
  p: LlmCallParams,
  apiKey: string,
  baseURL: string
): AsyncGenerator<LlmStreamChunk> {
  const body = buildOpenAIChatBody(p, { stream: true, stream_options: { include_usage: true } });

  // Si el cliente ya se fue antes de arrancar, no abrimos la conexión.
  if (p.signal?.aborted) return;

  const r = await fetchStreamWithConnectTimeout(
    `${baseURL}/chat/completions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(p.signal ? { signal: p.signal } : {}),
    },
    LLM_STREAM_CONNECT_TIMEOUT_MS
  );
  if (!r.ok || !r.body) {
    const txt = await r.text().catch(() => "");
    yield { type: "error", error: `Proveedor de chat ${r.status}: ${txt}` };
    return;
  }

  let totalTokens = 0;
  // Acumula tool_calls que llegan en deltas (por índice).
  const toolByIndex: Record<number, { id: string; name: string; args: string }> = {};
  for await (const ev of parseSSE(r.body, p.signal)) {
    if (ev.data === "[DONE]") break;
    const data = safeJsonParse(ev.data);
    const delta = data?.choices?.[0]?.delta;
    if (typeof delta?.content === "string" && delta.content) {
      yield { type: "text", delta: delta.content };
    }
    for (const tc of delta?.tool_calls ?? []) {
      const idx = tc.index ?? 0;
      const cur = (toolByIndex[idx] ??= { id: "", name: "", args: "" });
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name = tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
    }
    if (data?.usage?.total_tokens) totalTokens = data.usage.total_tokens;
  }
  for (const t of Object.values(toolByIndex)) {
    if (t.name)
      yield {
        type: "toolCall",
        toolCall: { id: t.id, name: t.name, input: safeJsonParse(t.args || "{}") ?? {} },
      };
  }
  yield { type: "done", tokensUsed: totalTokens, model: p.model };
}

/**
 * Parser minimal de Server-Sent Events. Lee el body como Uint8Array stream y
 * devuelve {event, data} por cada bloque vacío-line-separated.
 *
 * Si se pasa un `signal` (L5) y éste se aborta, dejamos de leer y cancelamos el
 * reader — esto cierra el body de la respuesta y la conexión TCP upstream, así
 * el provider deja de generar (y facturar) tokens cuando el cliente se va.
 */
async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  // Si el signal se aborta mientras estamos bloqueados en `reader.read()`,
  // cancelar el reader hace que la promesa pendiente resuelva/rechace y salimos.
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  if (signal) {
    if (signal.aborted) {
      await reader.cancel().catch(() => {});
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    while (true) {
      if (signal?.aborted) break;
      let value: Uint8Array | undefined;
      let done: boolean;
      try {
        ({ value, done } = await reader.read());
      } catch {
        // El reader fue cancelado (abort) o el stream se rompió: cortamos limpio.
        break;
      }
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = "message";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length > 0) {
          yield { event, data: dataLines.join("\n") };
        }
      }
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    // Asegura que el body upstream se libere si salimos por break (no por done).
    reader.cancel().catch(() => {});
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Pick the best available provider for one-shot tasks (prompt generation). */
export async function pickAvailableModel(
  workspaceId: string,
  tx?: WsDb
): Promise<{ provider: ProviderType; model: string } | null> {
  const db = tx ?? getDb();
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
