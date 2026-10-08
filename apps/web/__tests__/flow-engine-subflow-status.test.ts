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

describe("subflow: child end status", () => {
  const withChild = (status: string) => {
    state.runRow = { output: { answer: 1 }, status };
    state.flowQueue = [caller("flow_test", "child"), leaf("child")];
  };

  it("fails the step when the child ended paused", async () => {
    const child = flowRow(
      "child",
      [trigger, node("w", "wait_human", { message: "ok?" })],
      [edge("t", "w")],
      "Child Flow"
    );
    state.flowQueue = [caller("flow_test", "child"), child, child]; // the 2nd lookup names the error
    const r = await runFlowGraph(callerGraph("child"), callerEdges);
    expect(r.status).toBe("failed");
    expect(r.error).toContain(
      "Subflow Child Flow ended paused; only a succeeded subflow returns output"
    );
  });

  it("fails the step when the child ended cancelled", async () => {
    const { runIntegrationAction } = await import("@/lib/integrations/store");
    vi.mocked(runIntegrationAction).mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    );
    const child = flowRow(
      "child",
      [trigger, node("i", "integration", { integrationId: "x::y", input: {} })],
      [edge("t", "i")],
      "Child Flow"
    );
    state.flowQueue = [caller("flow_test", "child"), child, child];
    const r = await runFlowGraph(callerGraph("child"), callerEdges);
    expect(r.status).toBe("failed");
    expect(r.error).toContain(
      "Subflow Child Flow ended cancelled; only a succeeded subflow returns output"
    );
  });

  it("fails the step when the child failed", async () => {
    const child = flowRow("child", [], []); // no trigger node -> child run fails
    state.flowQueue = [caller("flow_test", "child"), child];
    const r = await runFlowGraph(callerGraph("child"), callerEdges);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("subflow failed");
  });

  it("continues when the child succeeded", async () => {
    withChild("succeeded");
    const r = await runFlowGraph(callerGraph("child"), callerEdges);
    expect(r.status).toBe("succeeded");
  });
});
