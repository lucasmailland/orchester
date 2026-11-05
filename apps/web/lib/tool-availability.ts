import "server-only";
import type { ToolContext, ToolDefinition } from "./tools";
import { recordToolCall } from "./activity/tool-calls";
import { mcpHashedToolName, mcpToolName } from "./integrations/mcp-policy";

export function toolNotAvailable(name: string): Error {
  return new Error(`Tool "${name}" is not available for this agent`);
}

export function assertToolOffered(
  name: string,
  offeredTools: readonly ToolDefinition[] | undefined
): ToolDefinition {
  const exact = offeredTools?.find((tool) => tool.name === name);
  if (exact) {
    if (exact.name.startsWith("mcp__") && (!exact.integrationId || !exact.remoteName)) {
      throw toolNotAvailable(name);
    }
    return exact;
  }
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

export async function checkToolOffered(
  name: string,
  input: unknown,
  ctx: ToolContext
): Promise<ToolDefinition> {
  try {
    return assertToolOffered(name, ctx.offeredTools);
  } catch (thrown) {
    await recordToolCall({
      workspaceId: ctx.workspaceId,
      source: ctx.source ?? "api",
      agentId: ctx.agentId,
      conversationId: ctx.conversationId,
      channelId: ctx.channelId,
      flowId: ctx.flowId,
      flowRunId: ctx.flowRunId,
      nodeId: ctx.nodeId,
      tool: name,
      input,
      startedAt: new Date(),
      durationMs: 0,
      thrown,
    });
    throw thrown;
  }
}
