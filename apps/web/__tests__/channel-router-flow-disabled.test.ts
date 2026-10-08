import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ executeFlow: vi.fn(), inserted: [] as any[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/flow-engine", () => ({ executeFlow: mocks.executeFlow }));
vi.mock("@/lib/llm-call", () => ({ llmCall: vi.fn(), llmStream: vi.fn() }));
vi.mock("@/lib/tools", () => ({ resolveToolDefinitions: vi.fn(), executeTool: vi.fn() }));
vi.mock("@/lib/cost-alerts", () => ({ assertWithinSpend: vi.fn() }));
vi.mock("@/lib/agent-runtime", () => ({
  UNTRUSTED_CONTENT_GUARDRAIL: "",
  wrapUntrusted: (s: string) => s,
}));
vi.mock("@/lib/billing/quotas", () => ({ checkQuota: async () => ({ allowed: true }) }));
vi.mock("@/lib/employee-budget", () => ({ checkEmployeeBudget: async () => ({ allowed: true }) }));
vi.mock("@/lib/tenant/context", () => ({
  withWorkspaceTx: async (_ws: string, fn: (tx: unknown) => unknown) => fn(makeTx()),
}));
vi.mock("@orchester/db", () => {
  const t = (name: string) =>
    new Proxy({ __t: name }, { get: (o, k) => (k === "__t" ? name : String(k)) });
  return {
    schema: {
      channels: t("channels"),
      agents: t("agents"),
      conversations: t("conversations"),
      messages: t("messages"),
    },
  };
});

const rows: Record<string, any[]> = {};
function makeTx() {
  return {
    select: () => ({
      from: (table: { __t: string }) => {
        const chain: any = {
          where: () => chain,
          orderBy: () => chain,
          limit: async () => rows[table.__t] ?? [],
        };
        return chain;
      },
    }),
    insert: () => ({
      values: async (v: unknown) => {
        mocks.inserted.push(v);
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
}

const { handleInbound } = await import("@/lib/channels/router");
const { FlowDisabledError } = await import("@/lib/flows/run-gate");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inserted.length = 0;
  rows.channels = [{ id: "ch1", status: "active", agentId: "a1", type: "api" }];
  rows.agents = [{ id: "a1", kind: "flow", flowId: "f1", fallback: "fallback reply" }];
  rows.conversations = [{ id: "c1", status: "open", messageCount: 0, takenOverAt: null }];
});

const msg = { channelId: "ch1", externalId: "x", text: "hi" } as any;

describe("flow-backed channel", () => {
  it("answers with the agent fallback when the flow is disabled", async () => {
    mocks.executeFlow.mockRejectedValue(new FlowDisabledError({ id: "f1", name: "F" }));
    const res = await handleInbound("w1", msg);
    expect(res.reply).toBe("fallback reply");
  });

  it("rethrows unrelated errors as themselves", async () => {
    const boom = new Error("boom");
    mocks.executeFlow.mockRejectedValue(boom);
    await expect(handleInbound("w1", msg)).rejects.toBe(boom);
  });
});
