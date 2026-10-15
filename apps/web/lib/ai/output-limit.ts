/**
 * The output token limit of a model call, and what a tool loop answers when a
 * reply reaches it.
 *
 * A leaf module on purpose: `llm-call`, the tool call log and the three tool
 * loops all read it, and none of them may import another just for a constant.
 */

/** `maxTokens` of a call that does not set one (an agent with no limit configured). */
export const DEFAULT_MAX_TOKENS = 1024;

/** How every refusal of a cut-off reply starts; the tool call log files it as `refused`. */
export const OUTPUT_LIMIT_REFUSAL_PREFIX = "Not run: the reply hit the output limit";

/** The error each tool call of a cut-off reply gets back, in place of a result. */
export function outputLimitRefusal(maxTokens: number | null | undefined): string {
  return (
    `${OUTPUT_LIMIT_REFUSAL_PREFIX} (${maxTokens ?? DEFAULT_MAX_TOKENS} tokens) before it ended, ` +
    "so its tool calls may be incomplete and none of them ran. Call the tool again with a " +
    "shorter input, or split the work into smaller calls."
  );
}
