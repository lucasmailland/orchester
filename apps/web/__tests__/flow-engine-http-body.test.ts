import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runFlowGraph } from "./flow-engine-harness";

vi.mock("@orchester/db", async () => (await import("./flow-engine-harness")).dbMock);
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/net-guard", () => ({
  readBodyCapped: async (r: Response) => Buffer.from(await r.text()),
  assertPublicUrl: vi.fn(),
  safeFetch: (url: string, init?: RequestInit) => fetch(url, init),
  BlockedDestinationError: class extends Error {},
}));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@/lib/llm-call", () => ({ llmCall: vi.fn(), llmStream: vi.fn() }));
vi.mock("@paralleldrive/cuid2", async () => {
  const { nextId } = await import("./flow-engine-harness");
  return { createId: () => nextId() };
});
vi.mock("@/lib/integrations/store", () => ({ runIntegrationAction: vi.fn() }));

const trigger = {
  id: "t",
  type: "trigger",
  label: "t",
  config: { triggerKind: "manual" },
  position: { x: 0, y: 0 },
};
const step = (config: Record<string, unknown>) => ({
  id: "h",
  type: "http",
  label: "h",
  config,
  position: { x: 0, y: 0 },
});
const edges = [{ id: "t-h", source: "t", target: "h" }];
const ok = { ok: true, status: 200, text: async () => "{}" } as Response;
const url = "https://example.com/hook";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok));
});
afterEach(() => vi.unstubAllGlobals());

describe("http node body", () => {
  it("a stored node without bodyMode keeps sending the raw interpolated text", async () => {
    const r = await runFlowGraph(
      [trigger, step({ url, method: "POST", body: '{"t":"{{v}}"}' })],
      edges,
      { v: "a" }
    );
    expect(r.status).toBe("succeeded");
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(init.body).toBe('{"t":"a"}');
  });

  it("bodyMode json escapes values and sends a JSON content-type", async () => {
    const r = await runFlowGraph(
      [trigger, step({ url, method: "POST", bodyMode: "json", body: '{"t":"{{v}}"}' })],
      edges,
      { v: '","admin":true,"x":"' }
    );
    expect(r.status).toBe("succeeded");
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ t: '","admin":true,"x":"' });
  });

  it("bodyMode json does not override a content-type the user set", async () => {
    await runFlowGraph(
      [
        trigger,
        step({
          url,
          method: "POST",
          bodyMode: "json",
          body: "{}",
          headers: { "Content-Type": "application/vnd.api+json" },
        }),
      ],
      edges
    );
    const headers = vi.mocked(fetch).mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/vnd.api+json");
    expect(headers["content-type"]).toBeUndefined();
  });
});
