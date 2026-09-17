import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
  it("legacy timeout stops at headers, allowing a slow body", async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        ...response(200, {}),
        text: () =>
          new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => resolve('{"ok":1}'), 100);
            init?.signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true }
            );
          }),
      } as Response;
    });
    const r = await runFlowGraph(
      [trigger, step("h", "http", { url, timeoutMs: 50 })],
      [edge("t", "h")]
    );
    expect(r.status).toBe("succeeded");
    expect(r.steps.find((s) => s.nodeId === "h")?.status).toBe("succeeded");
    expect(r.output.httpResult).toEqual({ ok: 1 });
  });
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

describe("retry cancellation", () => {
  it.each(["http", "integration"])(
    "cancels %s during backoff without another external call",
    async (type) => {
      const controller = new AbortController();
      const call = type === "http" ? vi.mocked(fetch) : runAction;
      call.mockImplementation(async () => {
        setTimeout(() => controller.abort(), 10);
        throw new Error("transient failure");
      });
      const r = await runFlowGraph(
        [
          trigger,
          step("x", type, {
            url: "https://example.com/hook",
            integrationId: "test::execute",
            input: {},
            retry: { attempts: 3, backoffMs: 100, maxBackoffMs: 100 },
          }),
        ],
        [edge("t", "x")],
        {},
        controller.signal
      );
      expect(call).toHaveBeenCalledTimes(1);
      expect(r.status).toBe("cancelled");
    }
  );
  it("aborts an in-flight retry http request", async () => {
    const controller = new AbortController();
    let requestAborted = false;
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      setTimeout(() => controller.abort(), 10);
      return new Promise<Response>((resolve, reject) => {
        const fallback = setTimeout(() => resolve(response(200, {})), 100);
        init?.signal?.addEventListener(
          "abort",
          () => {
            requestAborted = true;
            clearTimeout(fallback);
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true }
        );
      });
    });
    const r = await runFlowGraph(
      [trigger, step("h", "http", { url: "https://example.com/hook", retry: { attempts: 1 } })],
      [edge("t", "h")],
      {},
      controller.signal
    );
    expect(requestAborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("cancelled");
  });
});
