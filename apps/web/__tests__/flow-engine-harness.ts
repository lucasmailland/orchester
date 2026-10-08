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
  // AI trace persisted on the step (see StepTrace in flow-engine).
  trace?: Record<string, unknown>;
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
  /** When set, every flow_run row the engine inserts is pushed here. */
  insertedRuns: undefined as Array<Record<string, unknown>> | undefined,
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
    const trace: Record<string, unknown> = {};
    for (const k of ["agentId", "agentName", "model", "tokensUsed", "costUsd"]) {
      if (k in set) trace[k] = set[k];
    }
    if (Object.keys(trace).length) open.trace = trace;
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
      else if ("triggerSource" in row) state.insertedRuns?.push(row);
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
    // A subflow step reads the child run's output through the bare client.
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ output: {} }] }) }) }),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx())),
  })),
  schema: {
    flows: { id: "flows.id", workspaceId: "flows.workspaceId" },
    flowRuns: { id: "flowRuns.id" },
    flowRunSteps: { id: "flowRunSteps.id" },
    agents: { id: "agents.id" },
  },
};

export async function runFlowGraph(
  nodes: unknown[],
  edges: unknown[],
  input: Record<string, unknown> = {},
  signal?: AbortSignal,
  opts: { dryRun?: boolean } = {}
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
    ...(signal ? { signal } : {}),
    ...(opts.dryRun ? { dryRun: true } : {}),
  });
  const final = state.runUpdates.at(-1) ?? {};
  return {
    ...result,
    steps: state.steps,
    output: (final.output ?? {}) as Record<string, unknown>,
  };
}
