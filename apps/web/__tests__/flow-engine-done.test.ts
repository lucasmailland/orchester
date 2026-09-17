import { describe, it, expect, vi } from "vitest";
import { runFlowGraph } from "./flow-engine-harness";

vi.mock("@orchester/db", async () => (await import("./flow-engine-harness")).dbMock);
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/net-guard", () => ({ assertPublicUrl: vi.fn() }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@/lib/llm-call", () => ({ llmCall: vi.fn(), llmStream: vi.fn() }));
vi.mock("@paralleldrive/cuid2", async () => {
  const { nextId } = await import("./flow-engine-harness");
  return { createId: () => nextId() };
});

const runAction = vi.fn();
vi.mock("@/lib/integrations/store", () => ({
  runIntegrationAction: (...a: unknown[]) => runAction(...a),
}));

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  label: id,
  config,
  position: { x: 0, y: 0 },
});
const trigger = node("t", "trigger", { triggerKind: "manual" });
const set = (id: string, key: string) => node(id, "transform", { template: { [key]: "yes" } });
// An integration step with no integration selected throws "Falta elegir la app y la acción."
const boom = (id: string) => node(id, "integration", { integrationId: "" });
const e = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}-${target}-${sourceHandle ?? ""}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});
const ran = (r: Awaited<ReturnType<typeof runFlowGraph>>) => r.steps.map((s) => s.nodeId);

describe("try_catch done", () => {
  it("runs done once after a successful try", async () => {
    const r = await runFlowGraph(
      [trigger, node("tc", "try_catch"), set("a", "a"), set("d", "d")],
      [e("t", "tc"), e("tc", "a", "try"), e("tc", "d", "done")]
    );
    expect(r.status).toBe("succeeded");
    expect(ran(r)).toEqual(["t", "tc", "a", "d"]);
  });
  it("runs done after a caught error with a catch branch", async () => {
    const r = await runFlowGraph(
      [trigger, node("tc", "try_catch"), boom("x"), set("c", "c"), set("d", "d")],
      [e("t", "tc"), e("tc", "x", "try"), e("tc", "c", "catch"), e("tc", "d", "done")]
    );
    expect(r.status).toBe("succeeded");
    expect(ran(r)).toEqual(["t", "tc", "x", "c", "d"]);
  });
  it("runs done after a swallowed error without a catch branch", async () => {
    const r = await runFlowGraph(
      [trigger, node("tc", "try_catch"), boom("x"), set("d", "d")],
      [e("t", "tc"), e("tc", "x", "try"), e("tc", "d", "done")]
    );
    expect(r.status).toBe("succeeded");
    expect(r.output).toMatchObject({ d: "yes" });
  });
  it("does not run done when the catch branch throws", async () => {
    const r = await runFlowGraph(
      [trigger, node("tc", "try_catch"), boom("x"), boom("c"), set("d", "d")],
      [e("t", "tc"), e("tc", "x", "try"), e("tc", "c", "catch"), e("tc", "d", "done")]
    );
    expect(r.status).toBe("failed");
    expect(ran(r)).not.toContain("d");
  });
  it("chains blocks: a failure in the second still runs the third and the final step", async () => {
    const r = await runFlowGraph(
      [
        trigger,
        node("b1", "try_catch"),
        set("a", "a"),
        node("b2", "try_catch"),
        boom("x"),
        node("b3", "try_catch"),
        set("c", "c"),
        set("f", "f"),
      ],
      [
        e("t", "b1"),
        e("b1", "a", "try"),
        e("b1", "b2", "done"),
        e("b2", "x", "try"),
        e("b2", "b3", "done"),
        e("b3", "c", "try"),
        e("b3", "f", "done"),
      ]
    );
    expect(r.status).toBe("succeeded");
    expect(r.output).toMatchObject({ a: "yes", c: "yes", f: "yes" });
    expect(ran(r).filter((id) => id === "f")).toHaveLength(1);
  });
  it("a try_catch without done behaves as before", async () => {
    const r = await runFlowGraph(
      [trigger, node("tc", "try_catch"), set("a", "a"), set("z", "z")],
      [e("t", "tc"), e("tc", "a", "try"), e("tc", "z")]
    );
    expect(r.status).toBe("succeeded");
    expect(ran(r)).toEqual(["t", "tc", "a"]);
  });
  it("a retried integration step that always fails is caught, still records its attempts, and done runs", async () => {
    runAction.mockRejectedValue(new Error("odoo down"));
    const flaky = node("x", "integration", {
      integrationId: "odoo::execute",
      input: {},
      retry: { attempts: 2, backoffMs: 1, maxBackoffMs: 1 },
    });
    const r = await runFlowGraph(
      [trigger, node("tc", "try_catch"), flaky, set("c", "c"), set("d", "d")],
      [e("t", "tc"), e("tc", "x", "try"), e("tc", "c", "catch"), e("tc", "d", "done")]
    );
    expect(r.status).toBe("succeeded");
    expect(ran(r)).toEqual(["t", "tc", "x", "c", "d"]);
    const failed = r.steps.find((s) => s.nodeId === "x")!;
    expect(failed.status).toBe("failed");
    expect((failed.output as { attempts: unknown[] }).attempts).toHaveLength(2);
  });
});

describe("parallel done", () => {
  it("runs named non-done and handle-less branches before done once", async () => {
    const r = await runFlowGraph(
      [trigger, node("p", "parallel"), set("a", "a"), set("b", "b"), set("d", "d")],
      [e("t", "p"), e("p", "a", "x"), e("p", "b"), e("p", "d", "done")]
    );
    expect(r.status).toBe("succeeded");
    const steps = ran(r);
    expect(steps.filter((id) => id === "a")).toHaveLength(1);
    expect(steps.filter((id) => id === "b")).toHaveLength(1);
    expect(steps.filter((id) => id === "d")).toHaveLength(1);
    expect(steps.indexOf("d")).toBeGreaterThan(Math.max(steps.indexOf("a"), steps.indexOf("b")));
    expect(r.steps.find((s) => s.nodeId === "p")?.output).toEqual({ branches: 2 });
  });
  it("runs every branch, then done once, and done is not a branch", async () => {
    const r = await runFlowGraph(
      [trigger, node("p", "parallel"), set("a", "a"), set("b", "b"), set("d", "d")],
      [e("t", "p"), e("p", "a"), e("p", "b"), e("p", "d", "done")]
    );
    expect(r.status).toBe("succeeded");
    expect(ran(r).filter((id) => id === "d")).toHaveLength(1);
    expect(ran(r).indexOf("d")).toBeGreaterThan(Math.max(ran(r).indexOf("a"), ran(r).indexOf("b")));
  });
  it("does not run done when a branch fails", async () => {
    const r = await runFlowGraph(
      [trigger, node("p", "parallel"), boom("x"), set("d", "d")],
      [e("t", "p"), e("p", "x"), e("p", "d", "done")]
    );
    expect(r.status).toBe("failed");
    expect(ran(r)).not.toContain("d");
  });
});
