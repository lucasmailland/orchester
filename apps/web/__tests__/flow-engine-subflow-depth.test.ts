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

const callerGraph = (flowId: string) => [trigger, node("sub", "subflow", { flowId })];
const callerEdges = [edge("t", "sub")];
const flowRow = (id: string, nodes: unknown[], edges: unknown[], name = id) => ({
  id,
  name,
  workspaceId: "ws_test",
  enabled: true,
  nodes,
  edges,
  variables: {},
});
const leaf = (id: string) => flowRow(id, [trigger], []);
const caller = (id: string, calls: string) => flowRow(id, callerGraph(calls), callerEdges);

beforeEach(() => {
  state.flowQueue = [];
  state.insertedRuns = undefined;
  state.runRow = undefined;
  state.flow = { ...state.flow, enabled: true };
});

describe("subflow: recursion guard", () => {
  it("refuses a direct cycle and names the chain", async () => {
    state.flowQueue = [caller("flow_test", "B"), caller("B", "flow_test")];
    const r = await runFlowGraph(callerGraph("B"), callerEdges);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("flow_test -> B -> flow_test");
    expect(r.error).toContain("cycle");
  });

  it("refuses a linear chain of six flows", async () => {
    state.flowQueue = [
      caller("flow_test", "c1"),
      caller("c1", "c2"),
      caller("c2", "c3"),
      caller("c3", "c4"),
      caller("c4", "c5"),
      leaf("c5"),
    ];
    const r = await runFlowGraph(callerGraph("c1"), callerEdges);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("flow_test -> c1 -> c2 -> c3 -> c4 -> c5");
    expect(r.error).toContain("deeper than 5");
  });

  it("runs a chain of five flows", async () => {
    state.flowQueue = [
      caller("flow_test", "c1"),
      caller("c1", "c2"),
      caller("c2", "c3"),
      caller("c3", "c4"),
      leaf("c4"),
    ];
    const r = await runFlowGraph(callerGraph("c1"), callerEdges);
    expect(r.status).toBe("succeeded");
  });

  it("runs a chain of three flows", async () => {
    state.flowQueue = [caller("flow_test", "c1"), caller("c1", "c2"), leaf("c2")];
    const r = await runFlowGraph(callerGraph("c1"), callerEdges);
    expect(r.status).toBe("succeeded");
  });
});
