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
const flowRow = (id: string) => ({
  id,
  name: id,
  workspaceId: "ws_test",
  enabled: true,
  nodes: [trigger],
  edges: [],
  variables: {},
});

/** Runs a parent whose only step is a subflow with the given config. */
async function callWith(
  cfg: Record<string, unknown>,
  parentInput: Record<string, unknown>,
  childOutput: Record<string, unknown>,
  opts: { dryRun?: boolean } = {}
) {
  const graph = [trigger, node("sub", "subflow", { flowId: "child", ...cfg })];
  state.runRow = { output: childOutput, status: "succeeded" };
  state.flowQueue = [
    { ...flowRow("flow_test"), nodes: graph, edges: [edge("t", "sub")] },
    flowRow("child"),
  ];
  const inserted: Array<Record<string, unknown>> = [];
  state.insertedRuns = inserted;
  const r = await runFlowGraph(graph, [edge("t", "sub")], parentInput, undefined, opts);
  state.insertedRuns = undefined;
  const childRun = inserted.find((i) => i.flowId === "child");
  return { r, childRun, inserted };
}

beforeEach(() => {
  state.flowQueue = [];
  state.insertedRuns = undefined;
  state.runRow = undefined;
  state.flow = { ...state.flow, enabled: true };
});

describe("subflow without mapping (legacy)", () => {
  it("passes the whole bag and merges the child's variables back", async () => {
    const { r, childRun } = await callWith({}, { a: 1, b: 2 }, { a: 1, b: 2, extra: 3 });
    expect(childRun?.input).toMatchObject({ a: 1, b: 2 });
    expect(r.output).toMatchObject({ a: 1, b: 2, extra: 3 });
  });
});

describe("subflow inputs", () => {
  it("gives the child only the mapped variables, evaluated in the parent", async () => {
    const { childRun } = await callWith(
      { inputs: { who: "{{user.name}}", n: "{{count}}", fixed: "hello" } },
      { user: { name: "Ana" }, count: 7, secret: "nope" },
      {}
    );
    expect(childRun?.input).toEqual({ who: "Ana", n: 7, fixed: "hello" });
  });
  it("renders mixed templates as text", async () => {
    const { childRun } = await callWith(
      { inputs: { greeting: "Hi {{user.name}}!" } },
      { user: { name: "Ana" } },
      {}
    );
    expect(childRun?.input).toEqual({ greeting: "Hi Ana!" });
  });
  it("leaves unresolved paths unset", async () => {
    const { childRun } = await callWith({ inputs: { x: "{{nope.deep}}" } }, { a: 1 }, {});
    expect(childRun?.input).toEqual({});
  });
  it("fails the step when an expression throws", async () => {
    await expect(callWith({ inputs: { x: "{{a | nope}}" } }, { a: 1 }, {})).resolves.toMatchObject({
      r: { status: "failed" },
    });
  });
});

describe("subflow outputs", () => {
  it("writes only the mapped variables, from nested paths", async () => {
    const { r } = await callWith(
      { outputs: { total: "result.total", label: "{{result.label | upper}}" } },
      { keep: "me" },
      { result: { total: 9, label: "ok" }, leaked: "no" }
    );
    expect(r.output).toMatchObject({ keep: "me", total: 9, label: "OK" });
    expect(r.output).not.toHaveProperty("leaked");
    expect(r.output).not.toHaveProperty("result");
  });
  it("skips a path that resolves to nothing and keeps the earlier value", async () => {
    const { r } = await callWith(
      { outputs: { total: "result.missing" } },
      { total: "before" },
      { result: {} }
    );
    expect(r.status).toBe("succeeded");
    expect(r.output.total).toBe("before");
  });
  it("fails the step when an output expression throws", async () => {
    const { r } = await callWith({ outputs: { x: "a | nope" } }, {}, { a: 1 });
    expect(r.status).toBe("failed");
  });
});

describe("subflow inputs and outputs together", () => {
  it("isolates both ways", async () => {
    const { r, childRun } = await callWith(
      { inputs: { q: "{{message}}" }, outputs: { answer: "reply" } },
      { message: "hi", private: 1 },
      { q: "hi", reply: "yo", scratch: 1 }
    );
    expect(childRun?.input).toEqual({ q: "hi" });
    expect(r.output).toMatchObject({ answer: "yo", message: "hi", private: 1 });
    expect(r.output).not.toHaveProperty("scratch");
  });
  it("applies the same mapping on a dry run, which the child inherits", async () => {
    const { r, childRun, inserted } = await callWith(
      { inputs: { q: "{{message}}" }, outputs: { answer: "reply" } },
      { message: "hi", private: 1 },
      { reply: "yo", scratch: 1 },
      { dryRun: true }
    );
    expect(inserted.every((i) => String(i.triggerSource).endsWith(":dry-run"))).toBe(true);
    expect(childRun?.input).toEqual({ q: "hi" });
    expect(r.output).toMatchObject({ answer: "yo" });
    expect(r.output).not.toHaveProperty("scratch");
  });
});
