import { describe, it, expect, vi, beforeEach } from "vitest";
import { runFlowGraph, state } from "./flow-engine-harness";

vi.mock("@orchester/db", async () => (await import("./flow-engine-harness")).dbMock);
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/net-guard", () => ({ assertPublicUrl: vi.fn() }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@/lib/llm-call", () => ({ llmCall: vi.fn(), llmStream: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({ runChat: vi.fn(), chargeFor: vi.fn(), recordAiUsage: vi.fn() }));
vi.mock("@/lib/integrations/store", () => ({
  runIntegrationAction: vi.fn(),
  getIntegrationActionEffect: vi.fn(),
}));
vi.mock("@paralleldrive/cuid2", async () => {
  const { nextId } = await import("./flow-engine-harness");
  return { createId: () => nextId() };
});

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  label: id,
  config,
  position: { x: 0, y: 0 },
});
const trigger = node("t", "trigger", { triggerKind: "manual" });
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target });

const parentGraph = [trigger, node("sub", "subflow", { flowId: "child_flow" })];
const parentEdges = [edge("t", "sub")];
const child = (over: Record<string, unknown>) => ({
  id: "child_flow",
  name: "Child Flow",
  workspaceId: "ws_test",
  nodes: [trigger],
  edges: [],
  variables: {},
  ...over,
});

beforeEach(() => {
  state.flowQueue = [];
  state.insertedRuns = [];
  state.flow = { ...state.flow, enabled: true };
});

describe("run gate: subflow", () => {
  it("fails the parent step by name when the child is disabled, with no child run", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    state.insertedRuns = inserted;
    // 1st lookup is the parent (served by state.flow), 2nd is the child.
    state.flowQueue = [
      { ...state.flow, nodes: parentGraph, edges: parentEdges },
      child({ enabled: false }),
    ];
    const r = await runFlowGraph(parentGraph, parentEdges);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("Child Flow");
    expect(r.error).toContain("disabled");
    expect(inserted).toHaveLength(1); // only the parent run exists
  });

  it("runs an enabled child (regression)", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    state.insertedRuns = inserted;
    state.flowQueue = [
      { ...state.flow, nodes: parentGraph, edges: parentEdges },
      child({ enabled: true }),
    ];
    const r = await runFlowGraph(parentGraph, parentEdges);
    expect(r.status).toBe("succeeded");
    expect(inserted).toHaveLength(2);
  });

  it("lets a dry run go through a disabled child", async () => {
    state.flowQueue = [
      { ...state.flow, nodes: parentGraph, edges: parentEdges },
      child({ enabled: false }),
    ];
    const r = await runFlowGraph(parentGraph, parentEdges, {}, undefined, { dryRun: true });
    expect(r.status).toBe("succeeded");
  });
});

describe("run gate: executeFlow", () => {
  const run = async (opts: Record<string, unknown>) => {
    const { executeFlow } = await import("../lib/flow-engine");
    state.flow = { ...state.flow, enabled: false, name: "Off Flow", nodes: [trigger], edges: [] };
    return executeFlow({
      flowId: "flow_test",
      workspaceId: "ws_test",
      triggerSource: "test",
      input: {},
      ...opts,
    });
  };

  it("refuses an automated run of a disabled flow before creating a run", async () => {
    await expect(run({})).rejects.toThrow('Flow "Off Flow" is disabled');
    expect(state.insertedRuns).toHaveLength(0);
  });

  it("allows a dry run", async () => {
    expect((await run({ dryRun: true })).status).toBe("succeeded");
  });

  it("allows a manual run", async () => {
    expect((await run({ manual: true })).status).toBe("succeeded");
  });

  it("does not re-check a run the queue already admitted", async () => {
    expect((await run({ runId: "run_admitted" })).status).toBe("succeeded");
  });
});
