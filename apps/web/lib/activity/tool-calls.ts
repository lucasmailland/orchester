import "server-only";
import { schema } from "@orchester/db";
import { createId } from "@paralleldrive/cuid2";
import { CONNECTOR_TOOLS } from "@/lib/connector-tools";
import { redactUrl } from "@/lib/flows/dry-run";
import { WRITE_SCOPE_REFUSAL_PREFIX } from "@/lib/integrations/odoo-write-scope";
import { logWithContext } from "@/lib/observability";

/**
 * The tool call log: one `tool_call` row per call an agent makes through
 * `executeTool` and per real call of a flow `integration` step, so an admin
 * can see afterwards which agent read or wrote what. See migration
 * 0064_tool_call.sql.
 *
 * What is kept is deliberately small: a sanitized copy of the input, the
 * outcome, a bounded error message and the size of the result. The result
 * itself is never stored — it is customer data the log has no reason to copy.
 */

/** Where a call came from. Mirrored by the CHECK constraint in 0064. */
export const TOOL_CALL_SOURCES = [
  "channel",
  "test_chat",
  "api",
  "flow_agent",
  "flow_step",
  "mcp_server",
] as const;
export type ToolCallSource = (typeof TOOL_CALL_SOURCES)[number];
export type ToolCallOutcome = "ok" | "error" | "refused";

/** How a call ended: with what it returned, or with what it threw. */
export type ToolCallEnd = { result: unknown } | { thrown: unknown };

/** What the caller knows about a call before it runs. */
export interface ToolCallInfo {
  workspaceId: string;
  source: ToolCallSource;
  tool: string;
  input: unknown;
  agentId?: string | undefined;
  conversationId?: string | undefined;
  channelId?: string | undefined;
  flowId?: string | undefined;
  flowRunId?: string | undefined;
  nodeId?: string | undefined;
}

export type ToolCallEntry = ToolCallInfo & { startedAt: Date; durationMs: number } & ToolCallEnd;

const SECRET_KEY =
  /(token|secret|password|passwd|api[_-]?key|authorization|cookie|credential|bearer)/i;
const MAX_STRING = 200;
const MAX_ITEMS = 20;
const MAX_DEPTH = 4;
const MAX_INPUT_JSON = 4000;
const MAX_REF = 64;
const MAX_ERROR = 500;
const MAX_ERROR_CODE = 64;
/**
 * How long a caller waits for its row. The insert takes its own pool
 * connection while a channel turn may still hold one; if the pool is
 * exhausted, waiting without a bound would deadlock the turns that hold it.
 */
const RECORD_WAIT_MS = 2_000;

function sanitizeValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    const text = /^https?:\/\//i.test(value) ? redactUrl(value) : value;
    return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object") return undefined; // functions, symbols, undefined
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (ArrayBuffer.isView(value)) return `[binary ${value.byteLength} bytes]`;
  if (depth > MAX_DEPTH) return "[depth]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => sanitizeValue(item, depth + 1) ?? null);
    if (value.length > MAX_ITEMS) items.push(`[+${value.length - MAX_ITEMS} more]`);
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    const clean = sanitizeValue(inner, depth + 1);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

/**
 * A copy of a tool's input that is safe and small enough to keep: keys that
 * look like credentials are dropped at any depth, strings over 200 chars are
 * cut, arrays keep 20 items, containers deeper than 4 levels are replaced, and
 * URL query values and credentials are masked. When the result is still over
 * 4000 chars of JSON only the top-level keys are kept.
 */
export function sanitizeToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const clean = sanitizeValue(input, 1) as Record<string, unknown>;
  if (JSON.stringify(clean).length > MAX_INPUT_JSON) {
    return { _truncated: true, keys: Object.keys(clean) };
  }
  return clean;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function recordId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^\d{1,18}$/.test(value)) return value;
  return undefined;
}

/**
 * A short pointer to the business object a call was about, so the history of
 * one ticket can be looked up: an explicit `ticket_ref`, or the task/ticket id
 * of an Odoo tool or flow step as `odoo:<id>`.
 */
export function toolCallRef(tool: string, input: unknown): string | undefined {
  const args = asRecord(input);
  if (typeof args.ticket_ref === "string" && args.ticket_ref) {
    return args.ticket_ref.slice(0, MAX_REF);
  }
  if (!tool.startsWith("odoo_") && !tool.startsWith("odoo::")) return undefined;
  // A partner tool's `id` is a customer, not a task or a ticket.
  const keys = /partner/i.test(tool) ? ["task_id", "ticket_id"] : ["id", "task_id", "ticket_id"];
  for (const key of keys) {
    const id = recordId(args[key]);
    if (id) return `odoo:${id}`.slice(0, MAX_REF);
  }
  return undefined;
}

/**
 * Which integration a call went to. For `run_integration` and flow steps this
 * is whatever the caller named: usually the connector type (`odoo`), but it
 * can be an integration row id, which this function cannot resolve.
 */
export function integrationOf(tool: string, input: unknown): { type?: string; id?: string } {
  const mcp = /^mcp__(.+?)__/.exec(tool);
  if (mcp?.[1]) return { type: "mcp", id: mcp[1] };
  const connector = CONNECTOR_TOOLS[tool];
  if (connector) return { type: connector.integrationId };
  if (tool === "run_integration") {
    const integrationId = asRecord(input).integrationId;
    return typeof integrationId === "string" && integrationId ? { type: integrationId } : {};
  }
  const step = tool.indexOf("::");
  if (step > 0) return { type: tool.slice(0, step) };
  return {};
}

function bounded(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

/** An error message as kept: URLs in it masked like input URLs, then cut. */
function errorText(message: string): string {
  return bounded(
    message.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactUrl(url)),
    MAX_ERROR
  );
}

function stringProp(value: unknown, key: string): string | undefined {
  const prop = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : null;
  return typeof prop === "string" && prop ? prop : undefined;
}

/** How a call went, with a bounded error message and code when it failed. */
export function outcomeOf(end: ToolCallEnd): {
  outcome: ToolCallOutcome;
  errorCode?: string;
  error?: string;
} {
  if ("thrown" in end) {
    const e = end.thrown;
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes(WRITE_SCOPE_REFUSAL_PREFIX)) {
      return { outcome: "refused", errorCode: "write_scope", error: errorText(message) };
    }
    // An explicit code (`ECONNRESET`, a Postgres SQLSTATE) or a telling class
    // name (`TypeError`, `AbortError`); a bare `Error` says nothing.
    const name = e instanceof Error && e.name !== "Error" ? e.name : undefined;
    const code = stringProp(e, "code") ?? name;
    return {
      outcome: "error",
      ...(code ? { errorCode: bounded(code, MAX_ERROR_CODE) } : {}),
      error: errorText(message),
    };
  }
  const result = end.result;
  if (!result || typeof result !== "object") return { outcome: "ok" };
  const reported = stringProp(result, "error");
  const flagged = (result as { isError?: unknown }).isError === true;
  if (!reported && !flagged) return { outcome: "ok" };
  const content = (result as { content?: unknown }).content;
  const text =
    reported ??
    (Array.isArray(content)
      ? content
          .map((part) => stringProp(part, "text"))
          .filter(Boolean)
          .join("\n")
      : "");
  const code = stringProp(result, "code");
  return {
    outcome: "error",
    ...(code ? { errorCode: bounded(code, MAX_ERROR_CODE) } : {}),
    ...(text ? { error: errorText(text) } : {}),
  };
}

function resultSize(end: ToolCallEnd): number | null {
  if (!("result" in end)) return null;
  try {
    const json = JSON.stringify(end.result);
    return typeof json === "string" ? json.length : null;
  } catch {
    return null; // circular, BigInt, a throwing toJSON
  }
}

function toolCallRow(entry: ToolCallEntry) {
  const integration = integrationOf(entry.tool, entry.input);
  const { outcome, errorCode, error } = outcomeOf(entry);
  return {
    id: createId(),
    workspaceId: entry.workspaceId,
    createdAt: entry.startedAt,
    source: entry.source,
    agentId: entry.agentId ?? null,
    conversationId: entry.conversationId ?? null,
    channelId: entry.channelId ?? null,
    flowId: entry.flowId ?? null,
    flowRunId: entry.flowRunId ?? null,
    nodeId: entry.nodeId ?? null,
    tool: entry.tool,
    integrationType: integration.type ?? null,
    integrationId: integration.id ?? null,
    ref: toolCallRef(entry.tool, entry.input) ?? null,
    input: sanitizeToolInput(entry.input),
    outcome,
    errorCode: errorCode ?? null,
    error: error ?? null,
    durationMs: Math.max(0, Math.round(entry.durationMs)),
    resultSize: resultSize(entry),
  };
}

async function insertToolCall(workspaceId: string, row: ReturnType<typeof toolCallRow>) {
  // Its own transaction, never the caller's: a channel turn that fails rolls
  // its transaction back, and the calls it made must stay on record.
  const { withWorkspaceTx } = await import("@/lib/tenant/context");
  await withWorkspaceTx(workspaceId, (tx) => tx.insert(schema.toolCalls).values(row));
}

/**
 * Writes one `tool_call` row. Never throws and never delays the caller by more
 * than RECORD_WAIT_MS: logging must not change what the tool returned or threw.
 * A failure is logged with the tool name and the error only, never the input.
 */
export async function recordToolCall(entry: ToolCallEntry): Promise<void> {
  const failed = (e: unknown) =>
    logWithContext("warn", "tool_call.record_failed", {
      tool: entry.tool,
      error: e instanceof Error ? e.message : String(e),
    });
  let write: Promise<boolean>;
  try {
    write = insertToolCall(entry.workspaceId, toolCallRow(entry)).then(
      () => true,
      (e: unknown) => {
        failed(e);
        return true;
      }
    );
  } catch (e) {
    failed(e);
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), RECORD_WAIT_MS);
  });
  const finished = await Promise.race([write, slow]);
  clearTimeout(timer);
  // The insert goes on in the background and still logs if it fails.
  if (!finished) logWithContext("warn", "tool_call.record_slow", { tool: entry.tool });
}

/**
 * Runs one call and records it, whatever its outcome. What `run` returns or
 * throws is passed through unchanged.
 */
export async function withToolCallRecord<T>(info: ToolCallInfo, run: () => Promise<T>): Promise<T> {
  const startedAt = new Date();
  const durationMs = () => Date.now() - startedAt.getTime();
  let result: T;
  try {
    result = await run();
  } catch (thrown) {
    await recordToolCall({ ...info, startedAt, durationMs: durationMs(), thrown });
    throw thrown;
  }
  await recordToolCall({ ...info, startedAt, durationMs: durationMs(), result });
  return result;
}
