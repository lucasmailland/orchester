import { describe, it, expect, vi, beforeEach } from "vitest";
import { runFlowGraph, state } from "./flow-engine-harness";
import { describeFlow } from "@/lib/flows/describe";
import { validateStoredFlow } from "@/lib/flows/validate-stored";
import { summarizeFlowNature, summarizeFlowNatureTransitive } from "@/lib/flows/node-nature";
import { storedActionIssues } from "@/lib/flows/action-guard";

vi.mock("@orchester/db", async () => (await import("./flow-engine-harness")).dbMock);
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/net-guard", () => ({ assertPublicUrl: vi.fn() }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@/lib/llm-call", () => ({ llmCall: vi.fn(), llmStream: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({ runChat: vi.fn(), chargeFor: vi.fn(), recordAiUsage: vi.fn() }));
vi.mock("@paralleldrive/cuid2", async () => {
  const { nextId } = await import("./flow-engine-harness");
  return { createId: () => nextId() };
});

const calls: Array<{ action: string; input: unknown }> = [];
vi.mock("@/lib/integrations/store", () => ({
  runIntegrationAction: async (_ws: string, _id: string, action: string, input: unknown) => {
    calls.push({ action, input });
    if (action === "explode") throw new Error("remote said no");
    return { ok: true, action };
  },
  getIntegrationActionEffect: async (_ws: string, _id: string, action: string) =>
    action.startsWith("get") ? "read" : "write",
}));

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  label: id,
  config,
  position: { x: 0, y: 0 },
});
const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}-${target}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});

// A small flow with a branch, an integration read, a write and a transform.
const nodes = [
  node("t", "trigger", { triggerKind: "manual" }),
  node("fetch", "integration", { integrationId: "crm::get_case", input: { id: "{{caseId}}" } }),
  node("check", "condition", { left: "{{level}}", op: "==", right: "high" }),
  node("escalate", "integration", {
    integrationId: "crm::escalate",
    input: { id: "{{caseId}}" },
    outputVar: "escalation",
  }),
  node("note", "transform", { template: { summary: "case {{caseId}} is {{level}}" } }),
  node("post", "integration", { integrationId: "crm::post_note", input: { text: "{{summary}}" } }),
];
const edges = [
  edge("t", "fetch"),
  edge("fetch", "check"),
  edge("check", "escalate", "true"),
  edge("check", "note", "false"),
  edge("escalate", "note"),
  edge("note", "post"),
];
const groups = [
  { id: "g1", name: "Fetch the case", icon: "Globe", nodeIds: ["fetch", "check", "escalate"] },
  { id: "g2", name: "Write the note", description: "One line", nodeIds: ["note", "post"] },
];

async function run(withGroups: boolean, input: Record<string, unknown>, dryRun = false) {
  calls.length = 0;
  state.flowQueue = [];
  state.flow = {
    ...state.flow,
    enabled: true,
    ...(withGroups ? { groups } : {}),
  } as typeof state.flow;
  const r = await runFlowGraph(nodes, edges, input, undefined, { dryRun });
  return {
    status: r.status,
    error: r.error,
    output: r.output,
    steps: r.steps.map((s) => ({ nodeId: s.nodeId, status: s.status, output: s.output })),
    calls: [...calls],
  };
}

beforeEach(() => {
  state.flowQueue = [];
  state.runRow = undefined;
});

describe("groups do not change execution", () => {
  it.each([
    ["the high branch", { caseId: 7, level: "high" }],
    ["the other branch", { caseId: 8, level: "low" }],
  ])("runs %s identically with and without groups", async (_label, input) => {
    const plain = await run(false, input);
    const grouped = await run(true, input);
    expect(plain.status).toBe("succeeded");
    expect(grouped).toEqual(plain);
  });

  it("fails identically", async () => {
    const failing = nodes.map((n) =>
      n.id === "escalate" ? node("escalate", "integration", { integrationId: "crm::explode" }) : n
    );
    calls.length = 0;
    state.flow = { ...state.flow, enabled: true } as typeof state.flow;
    const a = await runFlowGraph(failing, edges, { caseId: 1, level: "high" });
    const callsA = [...calls];
    calls.length = 0;
    state.flow = { ...state.flow, groups } as typeof state.flow;
    const b = await runFlowGraph(failing, edges, { caseId: 1, level: "high" });
    expect(a.status).toBe("failed");
    expect(b.status).toBe(a.status);
    expect(b.error).toBe(a.error);
    expect([...calls]).toEqual(callsA);
  });

  it("dry-runs identically", async () => {
    const plain = await run(false, { caseId: 7, level: "high" }, true);
    const grouped = await run(true, { caseId: 7, level: "high" }, true);
    expect(plain.calls.map((c) => c.action)).toEqual(["get_case"]);
    expect(grouped).toEqual(plain);
  });
});

describe("groups are invisible to every reader of the graph", () => {
  const flow = { id: "f", name: "F", enabled: true, kind: "action", nodes, edges, variables: {} };
  const ctx = { otherFlows: [], webhooks: [], effects: {} };

  it("describe_flow", () => {
    expect(describeFlow({ ...flow, groups } as typeof flow, ctx)).toEqual(describeFlow(flow, ctx));
  });

  it("the stored-flow validator and the action contract", () => {
    const opts = { spec: null, kind: "action" as const, variables: {} };
    expect(validateStoredFlow(nodes, edges, opts)).toEqual(
      validateStoredFlow(nodes, edges, { ...opts, groups } as typeof opts)
    );
    expect(storedActionIssues({ ...flow, groups } as typeof flow)).toEqual(
      storedActionIssues(flow)
    );
  });

  it("node-nature counts", () => {
    expect(summarizeFlowNature(nodes).counts).toEqual({ ai: 0, code: 4, human: 0, control: 2 });
    expect(
      summarizeFlowNatureTransitive("f", [
        { id: "f", nodes, groups } as { id: string; nodes: typeof nodes },
      ])
    ).toEqual(summarizeFlowNatureTransitive("f", [{ id: "f", nodes }]));
  });
});
