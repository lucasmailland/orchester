import { describe, it, expect, vi, beforeEach } from "vitest";
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

const trigger = {
  id: "t",
  type: "trigger",
  label: "t",
  config: { triggerKind: "manual" },
  position: { x: 0, y: 0 },
};
const step = (id: string, type: string, config: Record<string, unknown>) => ({
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

beforeEach(() => {
  runAction.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe("harness sanity", () => {
  it("records a transform step and the run output", async () => {
    const r = await runFlowGraph(
      [trigger, step("x", "transform", { template: { a: "1" } })],
      [edge("t", "x")]
    );
    expect(r.status).toBe("succeeded");
    expect(r.steps.map((s) => [s.nodeId, s.status])).toEqual([
      ["t", "succeeded"],
      ["x", "succeeded"],
    ]);
    expect(r.output).toMatchObject({ a: "1" });
  });
});

describe("integration retry", () => {
  it("without retry config, fails on the first error (unchanged)", async () => {
    runAction.mockRejectedValue(new Error("odoo down"));
    const r = await runFlowGraph(
      [trigger, step("i", "integration", { integrationId: "odoo::execute", input: {} })],
      [edge("t", "i")]
    );
    expect(r.status).toBe("failed");
    expect(runAction).toHaveBeenCalledTimes(1);
  });
  it("retries and records attempts on the failed step", async () => {
    runAction.mockRejectedValue(new Error("odoo down"));
    const r = await runFlowGraph(
      [
        trigger,
        step("i", "integration", {
          integrationId: "odoo::execute",
          input: {},
          retry: { attempts: 3, backoffMs: 1, maxBackoffMs: 1 },
        }),
      ],
      [edge("t", "i")]
    );
    expect(r.status).toBe("failed");
    expect(runAction).toHaveBeenCalledTimes(3);
    const failed = r.steps.find((s) => s.nodeId === "i")!;
    expect(failed.status).toBe("failed");
    expect((failed.output as { attempts: unknown[] }).attempts).toHaveLength(3);
  });
  it("succeeds after a transient error and records both attempts", async () => {
    runAction.mockRejectedValueOnce(new Error("blip")).mockResolvedValueOnce({ result: 42 });
    const r = await runFlowGraph(
      [
        trigger,
        step("i", "integration", {
          integrationId: "odoo::execute",
          input: {},
          outputVar: "res",
          retry: { attempts: 2, backoffMs: 1, maxBackoffMs: 1 },
        }),
      ],
      [edge("t", "i")]
    );
    expect(r.status).toBe("succeeded");
    expect(r.output).toMatchObject({ res: { result: 42 } });
    expect(
      (r.steps.find((s) => s.nodeId === "i")!.output as { attempts: unknown[] }).attempts
    ).toHaveLength(2);
  });
});

const response = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as Response;

describe("http retry", () => {
  const url = "https://example.com/hook";
  it("legacy maxAttempts still retries a 400 when retry is absent", async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValueOnce(response(400, {})).mockResolvedValueOnce(response(200, { ok: 1 }));
    const r = await runFlowGraph(
      [trigger, step("h", "http", { url, method: "GET", maxAttempts: 2 })],
      [edge("t", "h")]
    );
    expect(r.status).toBe("succeeded");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("with retry, a 400 is not retried and returns as before", async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValue(response(400, { e: 1 }));
    const r = await runFlowGraph(
      [
        trigger,
        step("h", "http", {
          url,
          method: "GET",
          maxAttempts: 5,
          retry: { attempts: 3, backoffMs: 1, maxBackoffMs: 1 },
        }),
      ],
      [edge("t", "h")]
    );
    expect(r.status).toBe("succeeded");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("with retry, 503 is retried; failOnStatus fails the step at the end", async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValue(response(503, {}));
    const r = await runFlowGraph(
      [
        trigger,
        step("h", "http", {
          url,
          method: "GET",
          failOnStatus: true,
          retry: { attempts: 2, backoffMs: 1, maxBackoffMs: 1 },
        }),
      ],
      [edge("t", "h")]
    );
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.status).toBe("failed");
    expect(
      (r.steps.find((s) => s.nodeId === "h")!.output as { attempts: unknown[] }).attempts
    ).toHaveLength(2);
  });
  it("failOnStatus without retry fails a final 404", async () => {
    vi.mocked(fetch).mockResolvedValue(response(404, {}));
    const r = await runFlowGraph(
      [trigger, step("h", "http", { url, method: "GET", failOnStatus: true })],
      [edge("t", "h")]
    );
    expect(r.status).toBe("failed");
  });
});
