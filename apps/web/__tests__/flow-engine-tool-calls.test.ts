import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runFlowGraph, state } from "./flow-engine-harness";

vi.mock("@orchester/db", async () => (await import("./flow-engine-harness")).dbMock);
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@/lib/llm-call", () => ({ llmCall: vi.fn(), llmStream: vi.fn() }));
vi.mock("@paralleldrive/cuid2", async () => {
  const { nextId } = await import("./flow-engine-harness");
  return { createId: () => nextId() };
});

const runAction = vi.fn();
const effectOf = vi.fn();
vi.mock("@/lib/integrations/store", () => ({
  runIntegrationAction: (...a: unknown[]) => runAction(...a),
  getIntegrationActionEffect: (...a: unknown[]) => effectOf(...a),
}));

const trigger = {
  id: "t",
  type: "trigger",
  label: "t",
  config: { triggerKind: "manual" },
  position: { x: 0, y: 0 },
};
const integration = (config: Record<string, unknown>) => ({
  id: "s",
  type: "integration",
  label: "s",
  config,
  position: { x: 0, y: 0 },
});
const edges = [{ id: "t-s", source: "t", target: "s" }];

beforeEach(() => {
  runAction.mockReset();
  effectOf.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe("flow integration steps record their calls", () => {
  it("records one flow_step row with the run's ids and without the output", async () => {
    runAction.mockResolvedValue({ name: "OUTPUT-MARKER title" });
    const r = await runFlowGraph(
      [trigger, integration({ integrationId: "odoo::get_task", input: { id: "{{taskId}}" } })],
      edges,
      { taskId: 4512 }
    );
    expect(r.status).toBe("succeeded");
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0]).toMatchObject({
      workspaceId: "ws_test",
      source: "flow_step",
      tool: "odoo::get_task",
      flowId: "flow_test",
      flowRunId: r.runId,
      nodeId: "s",
      agentId: null,
      integrationType: "odoo",
      ref: "odoo:4512",
      input: { id: 4512 },
      outcome: "ok",
    });
    expect(JSON.stringify(state.toolCalls)).not.toContain("OUTPUT-MARKER");
  });

  it("records a failed call as an error", async () => {
    runAction.mockRejectedValue(new Error("odoo down"));
    const r = await runFlowGraph(
      [trigger, integration({ integrationId: "odoo::execute", input: {} })],
      edges
    );
    expect(r.status).toBe("failed");
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0]).toMatchObject({ outcome: "error", error: "odoo down" });
  });

  it("records every retry attempt as its own row", async () => {
    runAction.mockRejectedValueOnce(new Error("blip")).mockResolvedValueOnce({ ok: true });
    const r = await runFlowGraph(
      [
        trigger,
        integration({
          integrationId: "odoo::execute",
          input: {},
          retry: { attempts: 3, backoffMs: 1, maxBackoffMs: 1 },
        }),
      ],
      edges
    );
    expect(r.status).toBe("succeeded");
    expect(state.toolCalls.map((row) => row.outcome)).toEqual(["error", "ok"]);
  });

  it("does not record a write a dry run only simulates", async () => {
    effectOf.mockResolvedValue("write");
    const r = await runFlowGraph(
      [trigger, integration({ integrationId: "odoo::post_note", input: { id: 4512 } })],
      edges,
      {},
      undefined,
      { dryRun: true }
    );
    expect(r.status).toBe("succeeded");
    expect(runAction).not.toHaveBeenCalled();
    expect(state.toolCalls).toEqual([]);
  });

  it("records a read a dry run really executes", async () => {
    effectOf.mockResolvedValue("read");
    runAction.mockResolvedValue({ rows: [] });
    await runFlowGraph(
      [trigger, integration({ integrationId: "odoo::get_task", input: { id: 4512 } })],
      edges,
      {},
      undefined,
      { dryRun: true }
    );
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0]).toMatchObject({ source: "flow_step", outcome: "ok" });
  });
});
