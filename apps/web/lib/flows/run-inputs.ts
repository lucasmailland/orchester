/**
 * Inputs the run modal should ask for before starting a flow by hand.
 *
 * The modal used to offer only the flow's declared variables, so a
 * Manual start → Agent flow said "This flow doesn't need data to start" and
 * then sent an empty user message to the provider. An Agent step reads
 * `{{message}}` unless it has a prompt of its own.
 */

// Structural on purpose: the builder passes React Flow nodes, whose `data` is
// an open record, and nothing here needs more than `type` and `data.config`.
interface NodeLike {
  type?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

const ONLY_MESSAGE = /^\s*\{\{\s*message\s*\}\}\s*$/;

export function runInputsNeeded(nodes: NodeLike[], variables: Record<string, unknown>): string[] {
  if ("message" in variables) return [];
  const needsMessage = nodes.some((node) => {
    if (node.type !== "agent") return false;
    const cfg = (node.data?.config ?? {}) as Record<string, unknown>;
    const hasOwnText = [cfg.prompt, cfg.message].some(
      (v) => typeof v === "string" && v.trim() !== "" && !ONLY_MESSAGE.test(v)
    );
    return !hasOwnText;
  });
  return needsMessage ? ["message"] : [];
}
