import "server-only";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDefinition } from "@/lib/tools";
import { logWithContext, recordMetric } from "@/lib/observability";
import { assertMcpUrl, mcpToolName, offeredMcpTools, parseMcpConfig } from "./mcp-policy";

export interface McpIdentity {
  workspaceId: string;
  integrationId: string;
}
export interface McpToolDefinition extends ToolDefinition {
  remoteName: string;
  effect: "read" | "write";
}

const TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 100;
interface CacheEntry {
  fingerprint: string;
  expiresAt: number;
  tools?: McpToolDefinition[];
}
const cache = new Map<string, CacheEntry>();
const cacheKey = ({ workspaceId, integrationId }: McpIdentity) =>
  JSON.stringify([workspaceId, integrationId]);

export function invalidateMcpTools(workspaceId: string, integrationId: string): void {
  cache.delete(cacheKey({ workspaceId, integrationId }));
}

class McpOperationError extends Error {}

/** One deadline covers initialization, every page/request and response decoding. */
async function withClient<T>(
  config: Record<string, string>,
  operation: (client: Client, signal: AbortSignal) => Promise<T>
): Promise<T> {
  const parsed = parseMcpConfig(config);
  const abort = new AbortController();
  const client = new Client({ name: "orchester", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(parsed.url, {
    requestInit: { headers: parsed.authHeader ? { Authorization: parsed.authHeader } : {} },
    // Apply the guard and redirect policy to POST, SSE GET and DELETE alike.
    fetch: (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      assertMcpUrl(url);
      if (new URL(url).origin !== parsed.url.origin) throw new Error("MCP origin changed");
      return fetch(input, {
        ...init,
        redirect: "error",
        signal: init?.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal,
      });
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new McpOperationError("MCP operation timed out"));
      abort.abort();
    }, parsed.timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        // SDK sessionId getter includes undefined; its Transport interface omits it under exactOptionalPropertyTypes.
        await client.connect(transport as Transport, {
          signal: abort.signal,
          timeout: parsed.timeoutMs,
        });
        try {
          return await operation(client, abort.signal);
        } finally {
          // Best effort, still within the operation deadline; release stateful sessions.
          await transport.terminateSession().catch(() => {});
        }
      })(),
      deadline,
    ]);
  } catch (error) {
    // Remote errors can echo credentials/arguments. Do not persist or log them.
    if (error instanceof McpOperationError) throw error;
    throw new McpOperationError("MCP operation failed");
  } finally {
    clearTimeout(timer);
    abort.abort();
    await client.close().catch(() => {});
  }
}

async function listTools(config: Record<string, string>): Promise<Tool[]> {
  return withClient(config, async (client, signal) => {
    const tools: Tool[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { signal });
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new McpOperationError("MCP repeated a tools cursor");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return tools;
  });
}

export async function testMcpConnection(config: Record<string, string>) {
  try {
    const tools = await listTools(config);
    return { ok: true, meta: { toolCount: tools.length } };
  } catch {
    return { ok: false, error: "MCP connection test failed. Check URL, credentials and timeout." };
  }
}

export async function discoverMcpTools(
  identity: McpIdentity,
  config: Record<string, string>
): Promise<McpToolDefinition[]> {
  const parsed = parseMcpConfig(config);
  const key = cacheKey(identity);
  // Includes credentials and policy changes without retaining plaintext in the cache.
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(Object.entries(config).sort()))
    .digest("hex");
  const previous = cache.get(key);
  if (previous?.tools && previous.fingerprint === fingerprint && previous.expiresAt > Date.now()) {
    return structuredClone(previous.tools);
  }
  const entry: CacheEntry = { fingerprint, expiresAt: 0 };
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, entry);
  try {
    const tools = offeredMcpTools(await listTools(config), parsed.toolAllowlist).map((tool) => ({
      name: mcpToolName(identity.integrationId, tool.name),
      remoteName: tool.name,
      description: tool.description ?? tool.name,
      inputSchema: tool.inputSchema,
      effect: tool.effect,
    }));
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
      throw new McpOperationError("MCP tool names are not unique");
    }
    // An update/delete while discovery is pending must not revive the old cache.
    if (cache.get(key) === entry) {
      entry.tools = tools;
      entry.expiresAt = Date.now() + TTL_MS;
    }
    return structuredClone(tools);
  } catch (error) {
    if (cache.get(key) === entry) cache.delete(key);
    throw error;
  }
}

export async function callMcpTool(
  identity: McpIdentity,
  config: Record<string, string>,
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  const started = Date.now();
  let ok = false;
  try {
    const text = await withClient(config, async (client, signal) => {
      const result = await client.callTool({ name, arguments: input }, undefined, { signal });
      if (result.isError) throw new McpOperationError("MCP tool returned an error");
      const content = result.content as Array<{ type: string; text?: string }>;
      return content
        .map((part) => (part.type === "text" ? (part.text ?? "") : "[non-text content omitted]"))
        .join("\n");
    });
    ok = true;
    return text;
  } finally {
    const durationMs = Date.now() - started;
    logWithContext(ok ? "info" : "warn", "mcp.tool.call", {
      ...identity,
      tool: name,
      durationMs,
      ok,
      argumentKeys: Object.keys(input),
    });
    recordMetric("mcp.tool.duration_ms", durationMs, {
      integrationId: identity.integrationId,
      status: ok ? "ok" : "error",
    });
  }
}
