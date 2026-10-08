import type { StoredFlowNode } from "./normalize";

/**
 * The single definition of "this step calls another flow": a `subflow` or
 * `flow_call` node. Describe (fact sheet) and the relations map both read it,
 * so they cannot disagree about which steps are flow calls.
 *
 * Pure and client-safe.
 */
export const FLOW_CALL_TYPES: ReadonlySet<string> = new Set(["subflow", "flow_call"]);

export interface FlowCallStep {
  nodeId: string;
  /** The step's label, falling back to its id. */
  label: string;
  /** Target flow id; empty when the step has none configured yet. */
  flowId: string;
  inputs: string[];
  outputs: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The call a node makes, or null when it is not a flow-call step. */
export function flowCallOf(
  n: Pick<StoredFlowNode, "id" | "type" | "label" | "config">
): FlowCallStep | null {
  if (!FLOW_CALL_TYPES.has(n.type)) return null;
  const cfg = n.config;
  const id = typeof cfg.flowId === "string" ? cfg.flowId.trim() : "";
  return {
    nodeId: n.id,
    label: n.label || n.id,
    flowId: id,
    inputs: isRecord(cfg.inputs) ? Object.keys(cfg.inputs).sort() : [],
    outputs: isRecord(cfg.outputs) ? Object.keys(cfg.outputs).sort() : [],
  };
}

/** Every flow-call step of a graph, in step order. */
export function flowCallSteps(nodes: readonly StoredFlowNode[]): FlowCallStep[] {
  const out: FlowCallStep[] = [];
  for (const n of nodes) {
    const call = flowCallOf(n);
    if (call) out.push(call);
  }
  return out;
}
