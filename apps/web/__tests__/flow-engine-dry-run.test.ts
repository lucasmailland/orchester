import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runFlowGraph, state } from "./flow-engine-harness";

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
const effectOf = vi.fn();
vi.mock("@/lib/integrations/store", () => ({
  runIntegrationAction: (...a: unknown[]) => runAction(...a),
  getIntegrationActionEffect: (...a: unknown[]) => effectOf(...a),
}));

const runChat = vi.fn();
vi.mock("@/lib/ai/run", () => ({
  runChat: (...a: unknown[]) => runChat(...a),
  chargeFor: () => ({ tokensIn: 1, tokensOut: 1, costUsd: 0 }),
  recordAiUsage: vi.fn(),
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
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target });

const dry = (nodes: unknown[], edges: unknown[], input: Record<string, unknown> = {}) =>
  runFlowGraph(nodes, edges, input, undefined, { dryRun: true });

beforeEach(() => {
  runAction.mockReset();
  effectOf.mockReset();
  runChat.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("dry run: integration steps", () => {
  it("fails (no wouldCall) when the action cannot be resolved", async () => {
    effectOf.mockRejectedValue(new Error("Acción desconocida: get_case"));
    const r = await dry(
      [trigger, step("s", "integration", { integrationId: "odoo::get_case", input: {} })],
      [edge("t", "s")]
    );
    expect(r.status).toBe("failed");
    expect(runAction).not.toHaveBeenCalled();
    const st = r.steps.find((x) => x.nodeId === "s");
    expect(st?.status).toBe("failed");
    expect(JSON.stringify(st)).toContain("Acción desconocida: get_case");
    expect(JSON.stringify(st)).not.toContain("wouldCall");
  });

  it("executes a read action", async () => {
    effectOf.mockResolvedValue("read");
    runAction.mockResolvedValue({ rows: [1] });
    const r = await dry(
      [trigger, step("s", "integration", { integrationId: "odoo::get_task", input: { id: 1 } })],
      [edge("t", "s")]
    );
    expect(r.status).toBe("succeeded");
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(r.steps.find((s) => s.nodeId === "s")?.output).toEqual({ result: { rows: [1] } });
  });

  it("does not execute a write action and reports wouldCall with the interpolated input", async () => {
    effectOf.mockResolvedValue("write");
    const r = await dry(
      [
        trigger,
        step("s", "integration", {
          integrationId: "odoo::create_ticket",
          input: { name: "Hello {{who}}" },
        }),
      ],
      [edge("t", "s")],
      { who: "world" }
    );
    expect(r.status).toBe("succeeded");
    expect(runAction).not.toHaveBeenCalled();
    expect(r.steps.find((s) => s.nodeId === "s")?.output).toEqual({
      dryRun: true,
      wouldCall: {
        integrationId: "odoo",
        action: "create_ticket",
        input: { name: "Hello world" },
      },
    });
  });

  it("keeps going after a simulated write", async () => {
    effectOf.mockResolvedValue("write");
    const r = await dry(
      [
        trigger,
        step("s", "integration", { integrationId: "odoo::post_note", input: {} }),
        step("x", "transform", { template: { after: "yes" } }),
      ],
      [edge("t", "s"), edge("s", "x")]
    );
    expect(r.output).toMatchObject({ after: "yes" });
  });

  it("passes the real input to the effect resolver (execute depends on the method)", async () => {
    effectOf.mockResolvedValue("write");
    await dry(
      [
        trigger,
        step("s", "integration", {
          integrationId: "odoo::execute",
          input: { model: "project.task", method: "write" },
        }),
      ],
      [edge("t", "s")]
    );
    expect(effectOf).toHaveBeenCalledWith(
      "ws_test",
      "odoo",
      "execute",
      expect.objectContaining({ method: "write" })
    );
  });

  it("outside dry run a write action still executes", async () => {
    effectOf.mockResolvedValue("write");
    runAction.mockResolvedValue({ ok: true });
    await runFlowGraph(
      [trigger, step("s", "integration", { integrationId: "odoo::create_ticket", input: {} })],
      [edge("t", "s")]
    );
    expect(runAction).toHaveBeenCalledTimes(1);
  });
});

describe("dry run: http steps", () => {
  it("executes GET", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => '{"a":1}',
    });
    const r = await dry(
      [trigger, step("h", "http", { method: "GET", url: "https://x.test/a" })],
      [edge("t", "h")]
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(r.steps.find((s) => s.nodeId === "h")?.output).toMatchObject({ status: 200 });
  });

  it("simulates POST without leaking headers or auth", async () => {
    const r = await dry(
      [
        trigger,
        step("h", "http", {
          method: "POST",
          url: "https://x.test/a",
          body: '{"n":"{{v}}"}',
          headers: { "X-Secret": "s3cr3t" },
          auth: { kind: "bearer", token: "tok" },
        }),
      ],
      [edge("t", "h")],
      { v: "1" }
    );
    expect(fetch).not.toHaveBeenCalled();
    const out = r.steps.find((s) => s.nodeId === "h")?.output;
    expect(out).toEqual({
      dryRun: true,
      wouldCall: { method: "POST", url: "https://x.test/a", body: '{"n":"1"}' },
    });
    expect(JSON.stringify(out)).not.toMatch(/s3cr3t|tok/);
  });

  it("simulates POST without keeping secrets carried in the URL", async () => {
    const r = await dry(
      [
        trigger,
        step("h", "http", {
          method: "POST",
          url: "https://user:hunter2@x.test/a?token=abc123&page=2",
        }),
      ],
      [edge("t", "h")]
    );
    const out = r.steps.find((s) => s.nodeId === "h")?.output as {
      wouldCall: { url: string };
    };
    expect(out.wouldCall.url).toBe("https://x.test/a?token=***&page=***");
    expect(JSON.stringify(out)).not.toMatch(/hunter2|abc123|user/);
  });
});

describe("dry run: LLM steps", () => {
  it("executes llm_prompt", async () => {
    runChat.mockResolvedValue({ content: "hi", tokensUsed: 3, model: "m" });
    const r = await dry(
      [trigger, step("l", "llm_prompt", { model: "m", prompt: "say hi" })],
      [edge("t", "l")]
    );
    expect(runChat).toHaveBeenCalledTimes(1);
    expect(r.output).toMatchObject({ texto: "hi" });
  });
});

describe("dry run: notify and pause", () => {
  it("notify reports it would notify", async () => {
    const r = await dry(
      [trigger, step("n", "notify", { to: "a@b.c", channel: "email", message: "hi {{who}}" })],
      [edge("t", "n")],
      { who: "you" }
    );
    expect(r.steps.find((s) => s.nodeId === "n")?.output).toMatchObject({
      dryRun: true,
      wouldCall: { channel: "email", to: "a@b.c", message: "hi you" },
    });
  });
});

describe("dry run marking", () => {
  it("is recorded in triggerSource, which is what the history shows", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    state.insertedRuns = inserted;
    await dry([trigger], []);
    expect(inserted[0]?.triggerSource).toBe("test:dry-run");
    state.insertedRuns = undefined;
  });

  it("a real run keeps its triggerSource", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    state.insertedRuns = inserted;
    await runFlowGraph([trigger], []);
    expect(inserted[0]?.triggerSource).toBe("test");
    state.insertedRuns = undefined;
  });
});

describe("dry run helpers", () => {
  it("round-trips", async () => {
    const { markDryRun, isDryRunSource } = await import("@/lib/flows/dry-run");
    expect(isDryRunSource(markDryRun("manual:u1"))).toBe(true);
    expect(isDryRunSource("manual:u1")).toBe(false);
    expect(markDryRun(markDryRun("x"))).toBe("x:dry-run");
  });
});

describe("dry run: subflow", () => {
  it("the child run inherits dry run", async () => {
    effectOf.mockResolvedValue("write");
    const inserted: Array<Record<string, unknown>> = [];
    state.insertedRuns = inserted;
    // The harness serves the same flow for every lookup, so the child is the
    // flow itself. The parent marks `isChild` before calling it; the child
    // sees the mark in its input and takes the write branch instead.
    const r = await dry(
      [
        trigger,
        step("c", "condition", { left: "{{isChild}}", op: "==", right: "1" }),
        step("m", "transform", { template: { isChild: "1" } }),
        step("sub", "subflow", { flowId: "flow_test" }),
        step("w", "integration", { integrationId: "odoo::create_ticket", input: {} }),
      ],
      [
        edge("t", "c"),
        { id: "c-w", source: "c", target: "w", sourceHandle: "true" },
        { id: "c-m", source: "c", target: "m", sourceHandle: "false" },
        edge("m", "sub"),
      ]
    );
    expect(r.status).toBe("succeeded");
    expect(inserted).toHaveLength(2); // parent and child
    expect(inserted.every((i) => String(i.triggerSource).endsWith(":dry-run"))).toBe(true);
    expect(runAction).not.toHaveBeenCalled(); // the child's write was simulated
    state.insertedRuns = undefined;
  });
});
