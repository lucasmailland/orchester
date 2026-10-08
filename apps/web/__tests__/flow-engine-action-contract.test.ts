import { describe, it, expect, vi, beforeEach } from "vitest";
import { runFlowGraph, state } from "./flow-engine-harness";

vi.mock("@orchester/db", async () => (await import("./flow-engine-harness")).dbMock);
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/net-guard", () => ({ assertPublicUrl: vi.fn() }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@/lib/llm-call", () => ({ llmCall: vi.fn(), llmStream: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({
  runChat: vi.fn(async () => ({ content: "hi", tokensUsed: 1, model: "m" })),
  chargeFor: () => ({ tokensIn: 1, tokensOut: 1, costUsd: 0 }),
  recordAiUsage: vi.fn(),
}));
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
const ai = node("m", "llm_prompt", { model: "m", prompt: "hi" });
const plain = node("x", "transform", { template: { a: 1 } });

beforeEach(() => {
  state.flowQueue = [];
  state.flow = { ...state.flow, enabled: true, variables: {} };
  (state.flow as Record<string, unknown>).kind = "action";
});

describe("action contract at execution", () => {
  it("refuses to run an action whose graph violates the contract", async () => {
    const r = await runFlowGraph([trigger, ai], [edge("t", "m")]);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("m");
    expect(r.steps).toHaveLength(0);
  });
  it("runs an action that satisfies the contract", async () => {
    const r = await runFlowGraph([trigger, plain], [edge("t", "x")]);
    expect(r.status).toBe("succeeded");
  });
  it("still runs a violating pipeline", async () => {
    (state.flow as Record<string, unknown>).kind = "pipeline";
    const r = await runFlowGraph([trigger, ai], [edge("t", "m")]);
    expect(r.status).toBe("succeeded");
  });
  it("lets a dry run of a violating action proceed and carries the issues", async () => {
    const r = await runFlowGraph([trigger, ai], [edge("t", "m")], {}, undefined, {
      dryRun: true,
    });
    expect(r.status).toBe("succeeded");
    expect((r as { contractIssues?: Array<{ nodeId?: string }> }).contractIssues).toEqual([
      expect.objectContaining({ nodeId: "m" }),
    ]);
  });
});
