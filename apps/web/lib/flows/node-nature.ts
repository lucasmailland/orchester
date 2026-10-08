import { FLOW_NODE_TYPES, type FlowNodeType } from "./node-types";

/**
 * Design-time nature of a flow step: does it involve a model, a person, plain
 * code, or just routing? This is the static counterpart of the per-step trace
 * (`flow_run_step.agent_id/model`), which only knows what a run recorded.
 *
 * Client-safe on purpose (imports only `node-types`): the editor, the flows
 * list and the MCP tools all read it.
 *
 * - ai: the handler calls a model (chat, embedding, image, video, speech, OCR,
 *   rerank...). These are the steps that spend tokens and deserve review.
 * - human: the run pauses for a person.
 * - control: routing and structure only; no work happens in the step itself.
 * - code: deterministic work. An `integration` is code even if the remote app
 *   is smart, and a `subflow` is code at this level (see the transitive helper).
 */
export type NodeNature = "ai" | "code" | "human" | "control";

/** Exhaustive on purpose: adding a FlowNodeType without a nature fails tsc and the test. */
export const NODE_NATURE: Record<FlowNodeType, NodeNature> = {
  trigger: "control",
  agent: "ai",
  // Embeds the query with the knowledge base's embedding model.
  kb_search: "ai",
  generate_image: "ai",
  embed_text: "ai",
  llm_prompt: "ai",
  generate_video: "ai",
  text_to_speech: "ai",
  transcribe: "ai",
  rerank: "ai",
  generate_avatar: "ai",
  generate_music: "ai",
  ocr_extract: "ai",
  condition: "control",
  switch: "control",
  http: "code",
  integration: "code",
  transform: "code",
  spreadsheet: "code",
  delay: "code",
  notify: "code",
  code: "code",
  loop_for_each: "control",
  parallel: "control",
  try_catch: "control",
  subflow: "code",
  wait_human: "human",
  // Annotation: nothing runs.
  note: "control",
  end: "control",
};

const KNOWN = new Set<string>(FLOW_NODE_TYPES);

/** Unknown stored types fall back to "code": never claim AI without evidence. */
export function nodeNature(node: { type: string }): NodeNature {
  return KNOWN.has(node.type) ? NODE_NATURE[node.type as FlowNodeType] : "code";
}

export interface NatureNode {
  id: string;
  type: string;
  label?: string | undefined;
  config?: Record<string, unknown> | undefined;
}

export interface NatureFlow {
  id: string;
  nodes: readonly NatureNode[];
}

export interface FlowNatureSummary {
  total: number;
  counts: Record<NodeNature, number>;
  aiNodes: Array<{ id: string; label: string }>;
}

export function summarizeFlowNature(nodes: readonly NatureNode[]): FlowNatureSummary {
  const counts: Record<NodeNature, number> = { ai: 0, code: 0, human: 0, control: 0 };
  const aiNodes: Array<{ id: string; label: string }> = [];
  for (const n of nodes) {
    const nature = nodeNature(n);
    counts[nature]++;
    if (nature === "ai") aiNodes.push({ id: n.id, label: n.label || n.id });
  }
  return { total: nodes.length, counts, aiNodes };
}

export interface TransitiveFlowNatureSummary extends FlowNatureSummary {
  /** The flow has AI steps itself or reaches some through subflow calls. */
  reachesAi: boolean;
  /** Subflow nodes of this flow whose callee reaches AI. */
  aiSubflowNodeIds: string[];
}

function subflowTarget(n: NatureNode): string | null {
  const id = n.type === "subflow" ? n.config?.flowId : null;
  return typeof id === "string" && id ? id : null;
}

/** Cycle-safe: a flow being visited counts as "no AI found yet" on re-entry. */
function reaches(
  flowId: string,
  byId: Map<string, NatureFlow>,
  memo: Map<string, boolean>,
  visiting: Set<string>
): boolean {
  const known = memo.get(flowId);
  if (known !== undefined) return known;
  const flow = byId.get(flowId);
  if (!flow || visiting.has(flowId)) return false;
  visiting.add(flowId);
  let found = false;
  for (const n of flow.nodes) {
    if (nodeNature(n) === "ai") {
      found = true;
      break;
    }
    const target = subflowTarget(n);
    if (target && reaches(target, byId, memo, visiting)) {
      found = true;
      break;
    }
  }
  visiting.delete(flowId);
  // A negative found while inside a cycle may be incomplete; only cache positives
  // and top-level negatives.
  if (found || visiting.size === 0) memo.set(flowId, found);
  return found;
}

export function summarizeFlowNatureTransitive(
  flowId: string,
  flows: readonly NatureFlow[]
): TransitiveFlowNatureSummary {
  const byId = new Map(flows.map((f) => [f.id, f]));
  const flow = byId.get(flowId);
  const base = summarizeFlowNature(flow?.nodes ?? []);
  const memo = new Map<string, boolean>();
  const aiSubflowNodeIds: string[] = [];
  for (const n of flow?.nodes ?? []) {
    const target = subflowTarget(n);
    if (target && reaches(target, byId, memo, new Set([flowId]))) aiSubflowNodeIds.push(n.id);
  }
  return {
    ...base,
    reachesAi: base.counts.ai > 0 || aiSubflowNodeIds.length > 0,
    aiSubflowNodeIds,
  };
}
