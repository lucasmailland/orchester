import "server-only";
import type { ToolContext } from "@/lib/tools";
import { logWithContext } from "@/lib/observability";
import { listIntegrations, loadIntegration } from "./store";
import { callMcpTool, discoverMcpTools } from "./mcp-client";

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

export async function listWorkspaceMcpTools(workspaceId: string, tx?: WsDb) {
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
  return groups.flat();
}

export async function executeWorkspaceMcpTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  const integrations = await availableIntegrations(ctx.workspaceId, ctx.tx);
  for (const integration of integrations) {
    const identity = { workspaceId: ctx.workspaceId, integrationId: integration.id };
    let definitions;
    try {
      definitions = await discoverMcpTools(identity, integration.config);
    } catch {
      continue;
    }
    const tool = definitions.find((definition) => definition.name === name);
    if (tool) return callMcpTool(identity, integration.config, tool.remoteName, input);
  }
  throw new Error("MCP tool is unavailable or not allowed in this workspace");
}
