import "server-only";
import type { ToolDefinition } from "./tools";
import { mcpHashedToolName, mcpToolName } from "./integrations/mcp-policy";

export function toolNotAvailable(name: string): Error {
  return new Error(`Tool "${name}" is not available for this agent`);
}

export function assertToolOffered(
  name: string,
  offeredTools: readonly ToolDefinition[] | undefined
): ToolDefinition {
  const exact = offeredTools?.find((tool) => tool.name === name);
  if (exact) return exact;
  const tool = offeredTools?.find((tool) => {
    if (!tool.name.startsWith("mcp__") || !tool.integrationId || !tool.remoteName) return false;
    return (
      name === mcpHashedToolName(tool.integrationId, tool.remoteName) ||
      name === mcpToolName(tool.integrationId, tool.remoteName)
    );
  });
  if (!tool) throw toolNotAvailable(name);
  return tool;
}
