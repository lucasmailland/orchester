// Drives executeFlow over an in-memory graph. The DB mock cannot read the id
// inside a drizzle `where(eq(...))`, so it attributes each status update by the
// engine's own ordering: a step's status update always targets the innermost
// step that is still open (a try_catch/parallel step closes after its
// children). When no step is open, the update belongs to the run.
import { vi } from "vitest";

export interface RecordedStep {
  id: string;
  nodeId: string;
  status?: string;
  output?: unknown;
  error?: string;
}

export const state = {
  flow: {
    id: "flow_test",
    workspaceId: "ws_test",
    nodes: [] as unknown[],
    edges: [] as unknown[],
    variables: {},
  },
  steps: [] as RecordedStep[],
  runUpdates: [] as Array<Record<string, unknown>>,
};

let idCounter = 0;
export function nextId(): string {
  idCounter += 1;
  return `id_${idCounter}`;
}

function applySet(set: Record<string, unknown>) {
  if ("lastRunAt" in set) return; // the flow row's lastRunAt bump
  const open = [...state.steps].reverse().find((s) => !s.status);
  if (open && "status" in set) {
    open.status = String(set.status);
    if ("output" in set) open.output = set.output;
    if ("error" in set) open.error = String(set.error);
    return;
  }
  if ("status" in set) state.runUpdates.push(set);
}

function makeTx() {
  let pendingSet: Record<string, unknown> | null = null;
  const tx: Record<string, unknown> = {
    execute: vi.fn(async () => ({ rows: [] })),
    select: () => tx,
    from: () => tx,
    where: () => {
      if (pendingSet) {
        applySet(pendingSet);
        pendingSet = null;
        return Promise.resolve([]);
      }
      return { limit: async () => [state.flow] };
    },
    insert: () => tx,
    values: async (row: Record<string, unknown>) => {
      if ("nodeId" in row) state.steps.push({ id: String(row.id), nodeId: String(row.nodeId) });
    },
    update: () => tx,
    set: (s: Record<string, unknown>) => {
      pendingSet = s;
      return tx;
    },
  };
  return tx;
}

export const dbMock = {
  getDb: vi.fn(() => ({
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx())),
  })),
  schema: {
    flows: { id: "flows.id", workspaceId: "flows.workspaceId" },
    flowRuns: { id: "flowRuns.id" },
    flowRunSteps: { id: "flowRunSteps.id" },
  },
};

export async function runFlowGraph(
  nodes: unknown[],
  edges: unknown[],
  input: Record<string, unknown> = {}
) {
  state.flow = { ...state.flow, nodes, edges };
  state.steps = [];
  state.runUpdates = [];
  const { executeFlow } = await import("../lib/flow-engine");
  const result = await executeFlow({
    flowId: "flow_test",
    workspaceId: "ws_test",
    triggerSource: "test",
    input,
  });
  const final = state.runUpdates.at(-1) ?? {};
  return {
    ...result,
    steps: state.steps,
    output: (final.output ?? {}) as Record<string, unknown>,
  };
}
