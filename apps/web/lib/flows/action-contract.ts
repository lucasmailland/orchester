import { nodeNature } from "./node-nature";

/**
 * The contract of a reusable action, as data. Client-safe (imports only
 * `node-nature`): the validator turns the violations into issues and the
 * editor turns them into localized warnings.
 *
 * An action is deterministic and self-contained: no model calls, no person in
 * the loop, no calls to other flows and no flow-level variables. Pipelines
 * carry all of those.
 */
export type ActionViolationCode = "ai" | "human" | "flow_call" | "variables";

export interface ActionViolation {
  code: ActionViolationCode;
  /** Absent for flow-level violations (variables). */
  nodeId?: string;
  label?: string;
}

/** Calls to other flows. `flow_call` is the legacy spelling some stored graphs still use. */
const FLOW_CALL_TYPES = new Set(["subflow", "flow_call"]);

export function actionViolations(
  nodes: ReadonlyArray<{ id: string; type: string; label?: string | undefined }>,
  variables: unknown
): ActionViolation[] {
  const out: ActionViolation[] = [];
  for (const n of nodes) {
    const code: ActionViolationCode | null =
      nodeNature(n) === "ai"
        ? "ai"
        : n.type === "wait_human"
          ? "human"
          : FLOW_CALL_TYPES.has(n.type)
            ? "flow_call"
            : null;
    if (code) out.push({ code, nodeId: n.id, label: n.label || n.id });
  }
  if (
    typeof variables === "object" &&
    variables !== null &&
    !Array.isArray(variables) &&
    Object.keys(variables).length > 0
  ) {
    out.push({ code: "variables" });
  }
  return out;
}
