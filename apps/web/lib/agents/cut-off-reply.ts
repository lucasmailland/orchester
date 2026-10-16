import "server-only";
import { recordToolCall, type ToolCallInfo } from "@/lib/activity/tool-calls";
import { outputLimitRefusal } from "@/lib/ai/output-limit";
import type { ToolResultBlock, ToolUseBlock } from "@/lib/ai/capabilities";

/**
 * What the tool loops do with a reply that reached the output token limit.
 *
 * Such a reply can end in the middle of a tool call, whose input is then
 * incomplete: a note without its body, a search without its value. Running it
 * does the wrong thing, or fails with an error that sends the model looking
 * in the wrong place. So no call of that reply runs, not even the complete
 * ones before it: the model will repeat the whole reply, and a write that
 * already ran would then happen twice.
 *
 * Each call goes back to the model as an error that says what happened, and
 * to the tool call log as `refused`. The conversational loop, the test/MCP
 * runtime and the flow agent node all call this, so the three behave alike.
 */
export async function refuseCutOffReply(
  toolCalls: ToolUseBlock[],
  maxTokens: number | null | undefined,
  info: Omit<ToolCallInfo, "tool" | "input">
): Promise<Array<ToolResultBlock & { error: string }>> {
  const error = outputLimitRefusal(maxTokens);
  const startedAt = new Date();
  await Promise.all(
    toolCalls.map((tc) =>
      recordToolCall({
        ...info,
        tool: tc.name,
        input: tc.input,
        startedAt,
        durationMs: 0,
        thrown: new Error(error),
      })
    )
  );
  return toolCalls.map((tc) => ({ id: tc.id, name: tc.name, input: tc.input, error }));
}
