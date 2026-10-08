import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  flow: { id: "flow_1", name: "Off Flow", enabled: false } as Record<string, unknown>,
  inserts: [] as Array<Record<string, unknown>>,
  enqueued: [] as unknown[],
  counterUpdates: 0,
}));

vi.mock("@orchester/db", () => {
  const tx = {
    execute: vi.fn(async () => []),
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ value: 0 }]) }) }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        h.inserts.push(row);
      },
    }),
  };
  return {
    getDb: () => ({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [h.flow] }) }) }),
      transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    }),
    schema: {
      flows: { id: "f.id", name: "f.name", enabled: "f.enabled", workspaceId: "f.ws" },
      flowRuns: { flowId: "r.flowId", status: "r.status" },
      flowWebhooks: { secret: "w.secret", id: "w.id" },
    },
  };
});
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@/lib/queue", () => ({
  enqueue: async (...a: unknown[]) => void h.enqueued.push(a),
  JOB_FLOW_RUN: "flow.run",
}));
vi.mock("@/lib/net-guard", () => ({ assertPublicUrl: vi.fn() }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@/lib/llm-call", () => ({ llmCall: vi.fn(), llmStream: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({ runChat: vi.fn(), chargeFor: vi.fn(), recordAiUsage: vi.fn() }));
vi.mock("@/lib/integrations/store", () => ({
  runIntegrationAction: vi.fn(),
  getIntegrationActionEffect: vi.fn(),
}));
vi.mock("@/lib/mnemo/client", () => ({ getMnemoClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/tenant/cron", () => ({
  withCrossTenantAdmin: async (_n: string, fn: (t: unknown) => unknown) =>
    fn({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              { id: "wh_1", flowId: "flow_1", workspaceId: "ws_1", enabled: true, hmacKey: null },
            ],
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => {
            h.counterUpdates += 1;
          },
        }),
      }),
    }),
}));

beforeEach(() => {
  h.flow = { id: "flow_1", name: "Off Flow", enabled: false };
  h.inserts = [];
  h.enqueued = [];
  h.counterUpdates = 0;
});

const webhook = async () => {
  const { POST } = await import("@/app/api/webhooks/[secret]/route");
  return POST(new Request("https://x.test/api/webhooks/s", { method: "POST", body: "{}" }), {
    params: Promise.resolve({ secret: "s" }),
  });
};

describe("webhook", () => {
  it("answers 409 for a disabled flow and creates no run", async () => {
    const res = await webhook();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "flow is disabled" });
    expect(h.inserts).toHaveLength(0);
    expect(h.enqueued).toHaveLength(0);
    expect(h.counterUpdates).toBe(0);
  });

  it("still runs an enabled flow (regression)", async () => {
    h.flow.enabled = true;
    const res = await webhook();
    expect(res.status).toBe(202);
    expect(h.inserts).toHaveLength(1);
    expect(h.enqueued).toHaveLength(1);
  });
});

describe("flow_call tool", () => {
  const call = async () => {
    const { executeTool } = await import("@/lib/tools");
    return executeTool("flow_call", { flowId: "flow_1" }, { workspaceId: "ws_1", variables: {} });
  };

  it("returns an error to the agent for a disabled flow", async () => {
    await expect(call()).rejects.toThrow('Flow "Off Flow" is disabled');
    expect(h.inserts).toHaveLength(0);
  });

  it("runs an enabled flow", async () => {
    h.flow.enabled = true;
    expect(await call()).toMatchObject({ status: "pending" });
  });
});

describe("MCP run_flow", () => {
  const auth = { workspaceId: "ws_1", keyId: "k", scopes: [] as string[] };
  const call = async (input: Record<string, unknown>) => {
    const { callMcpTool } = await import("@/lib/mcp/server");
    return callMcpTool("run_flow", { flowId: "flow_1", ...input }, auth);
  };

  it("fails for a disabled flow", async () => {
    const res = (await call({})) as { isError?: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('Flow "Off Flow" is disabled');
    expect(h.inserts).toHaveLength(0);
  });

  it("runs a disabled flow as a dry run", async () => {
    await call({ dryRun: true });
    expect(h.inserts).toHaveLength(1);
    expect(String(h.inserts[0]?.triggerSource)).toBe("mcp:dry-run");
  });
});

describe("manual REST run", () => {
  it("lets a signed-in person run a disabled flow", async () => {
    vi.doMock("@/lib/auth-guards", () => ({
      requireAuth: async () => ({ workspace: { id: "ws_1" }, user: { id: "u1" } }),
      isAuthContext: () => true,
    }));
    const { POST } = await import("@/app/api/flows/[id]/run/route");
    const res = await POST(
      new Request("https://x.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: "flow_1" }) }
    );
    expect(res.status).toBe(202);
    expect(h.inserts).toHaveLength(1);
    expect(String(h.inserts[0]?.triggerSource)).toBe("manual:u1");
  });
});
