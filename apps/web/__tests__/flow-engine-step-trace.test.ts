import { describe, it, expect, vi, beforeEach } from "vitest";
import { runFlowGraph, state } from "./flow-engine-harness";

vi.mock("@orchester/db", async () => (await import("./flow-engine-harness")).dbMock);
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/net-guard", () => ({ assertPublicUrl: vi.fn() }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@paralleldrive/cuid2", async () => {
  const { nextId } = await import("./flow-engine-harness");
  return { createId: () => nextId() };
});

const runChat = vi.fn();
const llmCall = vi.fn();
vi.mock("@/lib/ai/run", () => ({
  runChat: (p: unknown) => runChat(p),
  chargeFor: () => ({ tokensIn: 3, tokensOut: 7, tokensTotal: 10, costUsd: "0.0123" }),
  recordAiUsage: vi.fn(async () => undefined),
}));
vi.mock("@/lib/llm-call", () => ({ llmCall: (p: unknown) => llmCall(p), llmStream: vi.fn() }));
vi.mock("@/lib/cost-alerts", () => ({ assertWithinSpend: vi.fn(async () => undefined) }));

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  label: id,
  config,
  position: { x: 0, y: 0 },
});
const trigger = node("t", "trigger", { triggerKind: "manual" });
const edge = [{ id: "e", source: "t", target: "p" }];

beforeEach(() => {
  runChat.mockReset();
  llmCall.mockReset();
});

describe("step trace", () => {
  it("llm_prompt records the effective model, tokens and cost, and no agent", async () => {
    runChat.mockResolvedValue({ content: "hi", tokensUsed: 10, model: "fallback-model" });
    const r = await runFlowGraph(
      [trigger, node("p", "llm_prompt", { model: "configured-model", prompt: "x" })],
      edge
    );
    const step = r.steps.find((s) => s.nodeId === "p")!;
    expect(step.status).toBe("succeeded");
    expect(step.trace).toMatchObject({
      model: "fallback-model",
      tokensUsed: 10,
      costUsd: "0.0123",
    });
    expect(step.trace?.agentId ?? null).toBeNull();
    expect(step.trace?.agentName ?? null).toBeNull();
  });

  it("a step that fails after spending tokens still records the trace", async () => {
    // The `content` getter throws after the call returned: the tokens were spent.
    const res = {
      tokensUsed: 10,
      model: "fallback-model",
      get content(): string {
        throw new Error("boom after the model answered");
      },
    };
    runChat.mockResolvedValue(res);
    const r = await runFlowGraph(
      [trigger, node("p", "llm_prompt", { model: "m", prompt: "x" })],
      edge
    ).catch(() => ({ steps: state.steps }));
    const step = r.steps.find((s) => s.nodeId === "p")!;
    expect(step.status).toBe("failed");
    expect(step.error).toContain("boom");
    expect(step.trace).toMatchObject({
      model: "fallback-model",
      tokensUsed: 10,
      costUsd: "0.0123",
    });
  });

  it("a step that records nothing has no trace", async () => {
    const r = await runFlowGraph([trigger, node("p", "transform", { template: { a: "b" } })], edge);
    expect(r.steps.find((s) => s.nodeId === "p")?.trace).toBeUndefined();
  });

  it("agent records the agent id, its name at run time, the model and the cost", async () => {
    // The harness answers every lookup with state.flow, so it doubles as the agent row.
    state.flow = { ...state.flow, name: "Support writer", model: "agent-model" } as never;
    llmCall.mockResolvedValue({ content: "done", tokensUsed: 10, model: "agent-model-eff" });
    const r = await runFlowGraph(
      [trigger, node("p", "agent", { agentId: "agent_1", prompt: "hello" })],
      edge
    );
    const step = r.steps.find((s) => s.nodeId === "p")!;
    expect(step.status).toBe("succeeded");
    expect(step.trace).toMatchObject({
      agentId: "agent_1",
      agentName: "Support writer",
      model: "agent-model-eff",
      tokensUsed: 10,
      costUsd: "0.0123",
    });
  });
});
