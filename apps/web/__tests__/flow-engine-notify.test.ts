import { describe, it, expect, vi, beforeEach } from "vitest";
import { runFlowGraph } from "./flow-engine-harness";

vi.mock("@orchester/db", async () => (await import("./flow-engine-harness")).dbMock);
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@/lib/llm-call", () => ({ llmCall: vi.fn(), llmStream: vi.fn() }));
vi.mock("@paralleldrive/cuid2", async () => {
  const { nextId } = await import("./flow-engine-harness");
  return { createId: () => nextId() };
});

const sendEmail = vi.fn(async () => ({ status: "sent" as const }));
vi.mock("@/lib/email", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...(a as [])) }));

const node = (id: string, type: string, config: Record<string, unknown>) => ({
  id,
  type,
  label: id,
  config,
  position: { x: 0, y: 0 },
});
const trigger = node("t", "trigger", { triggerKind: "manual" });
const edges = [{ id: "t-n", source: "t", target: "n" }];

beforeEach(() => sendEmail.mockClear());

describe("notify node", () => {
  it("sends the email when the channel is email", async () => {
    const r = await runFlowGraph(
      [trigger, node("n", "notify", { channel: "email", to: "{{who}}", message: "Run finished" })],
      edges,
      { who: "ada@example.com" }
    );
    expect(r.status).toBe("succeeded");
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ada@example.com", text: "Run finished" })
    );
  });

  it("fails when an email has no recipient", async () => {
    const r = await runFlowGraph(
      [trigger, node("n", "notify", { channel: "email", message: "x" })],
      edges
    );
    expect(r.status).toBe("failed");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("only records in a dry run", async () => {
    await runFlowGraph(
      [trigger, node("n", "notify", { channel: "email", to: "a@b.co", message: "x" })],
      edges,
      {},
      undefined,
      { dryRun: true }
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("only records on channels it cannot deliver", async () => {
    const r = await runFlowGraph(
      [trigger, node("n", "notify", { channel: "slack", message: "x" })],
      edges
    );
    expect(r.status).toBe("succeeded");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
