import "server-only";
import type { ToolContext } from "@/lib/tools";
import { logWithContext } from "@/lib/observability";
import { listIntegrations, loadIntegration } from "./store";
import { callMcpTool, discoverMcpTools } from "./mcp-client";
import { mcpHashedToolName } from "./mcp-policy";
import { assertToolOffered, toolNotAvailable } from "@/lib/tool-availability";

type WsDb = ToolContext["tx"];

async function availableIntegrations(workspaceId: string, tx?: WsDb) {
  const rows = await listIntegrations(workspaceId, tx);
  const loaded = await Promise.all(
    rows
      .filter((row) => row.type === "mcp" && row.enabled)
      .map((row) => loadIntegration(workspaceId, row.id, tx))
  );
  return loaded.filter(
    (row): row is NonNullable<typeof row> => row !== null && row.type === "mcp" && row.enabled
  );
}

type Integration = Awaited<ReturnType<typeof availableIntegrations>>[number];

/**
 * Readable names can coincide across integrations (key "a_" + tool "b" vs key "a" + tool "_b").
 * Every colliding entry falls back to its hashed name, so the outcome ignores list order.
 */
function resolveNameCollisions<
  T extends { name: string; remoteName: string; integrationId: string },
>(tools: T[]): T[] {
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  return tools.map((tool) =>
    counts.get(tool.name)! > 1
      ? { ...tool, name: mcpHashedToolName(tool.integrationId, tool.remoteName) }
      : tool
  );
}

async function discoverAll(workspaceId: string, tx?: WsDb) {
  const integrations = await availableIntegrations(workspaceId, tx);
  const groups = await Promise.all(
    integrations.map(async (integration) => {
      try {
        const definitions = await discoverMcpTools(
          { workspaceId, integrationId: integration.id },
          integration.config
        );
        return definitions.map((tool) => ({
          ...tool,
          integrationId: integration.id,
          integrationName: integration.name,
          integration,
        }));
      } catch {
        // An unavailable server must not prevent use of builtins or healthy integrations.
        logWithContext("warn", "mcp.tools.discovery_failed", {
          workspaceId,
          integrationId: integration.id,
        });
        return [];
      }
    })
  );
  return resolveNameCollisions(groups.flat());
}

/**
 * `legacyName` is the hashed name earlier versions gave every tool. Agents that
 * saved it in `agent.tools` keep matching: it is an alias of the same remote
 * tool, never listed on its own.
 */
export async function listWorkspaceMcpTools(workspaceId: string, tx?: WsDb) {
  return (await discoverAll(workspaceId, tx)).map(({ integration: _integration, ...tool }) => ({
    ...tool,
    legacyName: mcpHashedToolName(tool.integrationId, tool.remoteName),
  }));
}

export async function executeWorkspaceMcpTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  const offeredTools = ctx.offeredTools ?? [];
  assertToolOffered(name, offeredTools);
  // Discovery refreshes availability; only definitions offered for this call can run.
  const all = await discoverAll(ctx.workspaceId, ctx.tx);
  const allowed = all.filter((tool) =>
    offeredTools.some(
      (offered) =>
        (offered.name === tool.name ||
          offered.name === mcpHashedToolName(tool.integrationId, tool.remoteName)) &&
        (!offered.integrationId || offered.integrationId === tool.integrationId) &&
        (!offered.remoteName || offered.remoteName === tool.remoteName)
    )
  );
  // The readable name wins; the legacy hashed name is accepted as an alias.
  const tool =
    allowed.find((t) => t.name === name) ??
    allowed.find((t) => mcpHashedToolName(t.integrationId, t.remoteName) === name);
  if (tool) {
    const identity = { workspaceId: ctx.workspaceId, integrationId: tool.integrationId };
    return callMcpTool(identity, (tool.integration as Integration).config, tool.remoteName, input);
  }
  throw toolNotAvailable(name);
}
