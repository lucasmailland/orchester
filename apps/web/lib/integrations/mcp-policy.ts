import "server-only";
import { createHash } from "node:crypto";
import { assertPublicUrl } from "@/lib/net-guard";

export function assertMcpUrl(raw: string): URL {
  const url = new URL(raw);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("MCP requires an HTTP(S) URL without credentials");
  }
  const allowed = (process.env.MCP_ALLOWED_PRIVATE_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.includes(url.host.toLowerCase()) || allowed.includes(url.hostname.toLowerCase())) {
    return url;
  }
  if (url.protocol !== "https:")
    throw new Error("MCP requires HTTPS outside the private host allowlist");
  return assertPublicUrl(raw);
}

export function parseMcpConfig(config: Record<string, string>) {
  const url = assertMcpUrl(config.url ?? "");
  const timeoutMs = Number(config.timeoutMs || 20_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("MCP timeoutMs must be an integer between 1 and 60000");
  }
  let toolAllowlist: string[] | undefined;
  if (config.toolAllowlist?.trim()) {
    let value: unknown;
    try {
      value = JSON.parse(config.toolAllowlist);
    } catch {
      throw new Error("MCP toolAllowlist must be a JSON array of tool names");
    }
    if (
      !Array.isArray(value) ||
      !value.every((name) => typeof name === "string" && name.length > 0)
    ) {
      throw new Error("MCP toolAllowlist must be a JSON array of tool names");
    }
    toolAllowlist = value;
  }
  return { url, timeoutMs, toolAllowlist, authHeader: config.authHeader || undefined };
}

interface AnnotatedTool {
  name: string;
  annotations?:
    { readOnlyHint?: boolean | undefined; destructiveHint?: boolean | undefined } | undefined;
}

export function offeredMcpTools<T extends AnnotatedTool>(tools: T[], allowlist?: string[]) {
  return tools
    .filter((tool) => {
      if (allowlist !== undefined) return allowlist.includes(tool.name);
      return tool.annotations?.readOnlyHint === true && tool.annotations.destructiveHint !== true;
    })
    .map((tool) => ({
      ...tool,
      effect: (tool.annotations?.readOnlyHint === true && tool.annotations.destructiveHint !== true
        ? "read"
        : "write") as "read" | "write",
    }));
}

const MAX_PROVIDER_TOOL_NAME = 64;
const SAFE_PART = /^[a-zA-Z0-9_-]+$/;

/** Hash the original pair so sanitation/truncation collisions remain stable across list order. */
export function mcpHashedToolName(integrationKey: string, toolName: string): string {
  const clean = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");
  const suffix = createHash("sha256")
    .update(JSON.stringify([integrationKey, toolName]))
    .digest("hex")
    .slice(0, 16);
  return `mcp__${clean(integrationKey).slice(0, 20)}__${clean(toolName).slice(0, 20)}_${suffix}`;
}

/**
 * Readable `mcp__<key>__<tool>` when nothing needs sanitising or truncating and the `__`
 * separator stays unambiguous; otherwise the hashed form. Names are persisted in
 * `agent.tools`, so this scheme must not change for existing inputs.
 */
export function mcpToolName(integrationKey: string, toolName: string): string {
  const readable = `mcp__${integrationKey}__${toolName}`;
  if (
    SAFE_PART.test(integrationKey) &&
    SAFE_PART.test(toolName) &&
    !integrationKey.includes("__") &&
    !toolName.includes("__") &&
    readable.length <= MAX_PROVIDER_TOOL_NAME
  ) {
    return readable;
  }
  return mcpHashedToolName(integrationKey, toolName);
}
