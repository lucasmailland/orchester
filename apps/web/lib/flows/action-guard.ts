import { normalizeFlowNodes } from "./normalize";
import { actionContractIssues } from "./validate-stored";
import type { ValidationIssue } from "./validate";

/**
 * Action contract violations of a STORED flow, for the places that decide whether it may
 * be enabled or executed. Empty for anything that is not an action.
 *
 * The REST editor saves drafts without enforcing the contract (so authors can work in
 * steps), which means the stored graph of an action can violate it. These checks keep such
 * a flow from being switched on or run.
 */
export function storedActionIssues(flow: {
  kind?: string | null | undefined;
  nodes: unknown;
  variables: unknown;
}): ValidationIssue[] {
  if (flow.kind !== "action") return [];
  const nodes = normalizeFlowNodes(Array.isArray(flow.nodes) ? flow.nodes : []);
  return actionContractIssues(nodes, flow.variables);
}

export function issuesSummary(issues: ValidationIssue[]): string {
  return issues.map((i) => i.message).join(" ");
}
