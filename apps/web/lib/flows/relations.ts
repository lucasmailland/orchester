import { flowCallSteps } from "./flow-calls";
import { readExternalCallers, type ExternalCaller, type FlowKind } from "./kind";
import { summarizeFlowNature, summarizeFlowNatureTransitive } from "./node-nature";
import { normalizeFlowNodes } from "./normalize";

/**
 * How flows relate to each other, for every flow of a workspace in one pass.
 * Pure and client-safe. "Which steps call a flow" is `flowCallSteps`, the same
 * definition the fact sheet (`describe`) uses.
 *
 * - A flow called twice by the same parent is one relation; the step labels
 *   are listed in `steps`.
 * - A flow calling itself is not a relation of interest and is left out.
 * - A target id that matches no flow of the workspace is listed as `missing`.
 * - `ai` on a callee means it has AI steps itself or reaches some through its
 *   own sub-flow calls (cycle-safe, see `summarizeFlowNatureTransitive`); on a
 *   caller it means the caller has AI steps of its own.
 */

export interface RelationFlowInput {
  id: string;
  name: string;
  kind?: string | null | undefined;
  /** Untrusted stored JSON. */
  nodes: unknown;
  externalCallers?: unknown;
}

export interface FlowLink {
  flowId: string;
  /** Null when the flow no longer exists. */
  name: string | null;
  kind: FlowKind | null;
  ai: boolean;
  missing: boolean;
  /** Labels of the steps that make the call, in step order. */
  steps: string[];
}

export interface FlowRelations {
  /** Flows that call this one. */
  usedBy: FlowLink[];
  /** Flows this one calls, in step order. */
  uses: FlowLink[];
  externalCallers: ExternalCaller[];
  /** Enabled webhooks and schedules that start this flow. */
  webhooks: number;
  schedules: number;
}

export type TriggerCounts = Record<string, { webhooks: number; schedules: number } | undefined>;

export function computeFlowRelations(
  flows: readonly RelationFlowInput[],
  triggers: TriggerCounts
): Record<string, FlowRelations> {
  const byId = new Map(flows.map((f) => [f.id, f]));
  const graphs = flows.map((f) => ({
    id: f.id,
    nodes: normalizeFlowNodes(f.nodes),
  }));
  const calls = new Map(graphs.map((g) => [g.id, flowCallSteps(g.nodes)]));

  const aiMemo = new Map<string, boolean>();
  const hasAi = (id: string): boolean => {
    let v = aiMemo.get(id);
    if (v === undefined) {
      v = summarizeFlowNatureTransitive(id, graphs).reachesAi;
      aiMemo.set(id, v);
    }
    return v;
  };
  // A caller's marker is its own AI steps only: counting what it reaches
  // through this very flow would flag every caller of an AI flow.
  const ownAi = (id: string): boolean => {
    const g = graphs.find((x) => x.id === id);
    return g ? summarizeFlowNature(g.nodes).counts.ai > 0 : false;
  };
  const kindOf = (f: RelationFlowInput): FlowKind => (f.kind === "action" ? "action" : "pipeline");

  const out: Record<string, FlowRelations> = {};
  for (const f of flows) {
    out[f.id] = {
      usedBy: [],
      uses: [],
      externalCallers: readExternalCallers(f.externalCallers),
      webhooks: triggers[f.id]?.webhooks ?? 0,
      schedules: triggers[f.id]?.schedules ?? 0,
    };
  }

  for (const parent of flows) {
    const seen = new Map<string, { use: FlowLink; by: FlowLink | null }>();
    for (const step of calls.get(parent.id) ?? []) {
      if (!step.flowId || step.flowId === parent.id) continue;
      const known = seen.get(step.flowId);
      if (known) {
        known.use.steps.push(step.label);
        known.by?.steps.push(step.label);
        continue;
      }
      const child = byId.get(step.flowId);
      const use: FlowLink = child
        ? {
            flowId: child.id,
            name: child.name,
            kind: kindOf(child),
            ai: hasAi(child.id),
            missing: false,
            steps: [step.label],
          }
        : {
            flowId: step.flowId,
            name: null,
            kind: null,
            ai: false,
            missing: true,
            steps: [step.label],
          };
      out[parent.id]!.uses.push(use);
      let by: FlowLink | null = null;
      if (child) {
        by = {
          flowId: parent.id,
          name: parent.name,
          kind: kindOf(parent),
          ai: ownAi(parent.id),
          missing: false,
          steps: [step.label],
        };
        out[child.id]!.usedBy.push(by);
      }
      seen.set(step.flowId, { use, by });
    }
  }
  return out;
}

/** What the two chips show: everything that starts or calls it, and the flows it calls. */
export function relationCounts(r: FlowRelations): { usedBy: number; uses: number } {
  return {
    usedBy: r.usedBy.length + r.externalCallers.length + r.webhooks + r.schedules,
    uses: r.uses.length,
  };
}
