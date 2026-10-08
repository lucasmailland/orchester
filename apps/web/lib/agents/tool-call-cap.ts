import { z } from "zod";

/**
 * How many model calls one turn of an agent may make while it uses tools.
 * Stored as `agent.config.maxToolCalls`. The conversational loop, the
 * test/MCP runtime and the flow agent node all read it through
 * `resolveMaxToolCalls`, so the three can never disagree.
 */
export const DEFAULT_MAX_TOOL_CALLS = 5;
export const MIN_MAX_TOOL_CALLS = 1;
export const MAX_MAX_TOOL_CALLS = 15;

export const maxToolCallsSchema = z
  .number()
  .int("maxToolCalls must be an integer")
  .min(MIN_MAX_TOOL_CALLS, `maxToolCalls must be at least ${MIN_MAX_TOOL_CALLS}`)
  .max(MAX_MAX_TOOL_CALLS, `maxToolCalls must be at most ${MAX_MAX_TOOL_CALLS}`);

/**
 * The cap for an agent. A missing or non-numeric stored value means the
 * default; a number outside the range (written by hand, or by an older build)
 * is clamped rather than trusted, so a corrupt row can neither disable the cap
 * nor turn the loop unbounded.
 */
export function resolveMaxToolCalls(config: unknown): number {
  const raw =
    config && typeof config === "object" ? (config as Record<string, unknown>).maxToolCalls : null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_MAX_TOOL_CALLS;
  return Math.min(Math.max(Math.trunc(raw), MIN_MAX_TOOL_CALLS), MAX_MAX_TOOL_CALLS);
}

/** Merges a patch into a stored config without dropping keys it does not know. */
export function mergeAgentConfig(
  existing: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return { ...base, ...patch };
}
