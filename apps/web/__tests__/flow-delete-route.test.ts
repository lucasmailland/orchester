import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  returning: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/auth-guards", () => ({
  requireAuth: async () => ({ workspace: { id: "ws_test" }, user: { id: "user_test" } }),
  isAuthContext: () => true,
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.logAudit }));
vi.mock("@/lib/workspace", () => ({}));
vi.mock("@/lib/flows/service", () => ({
  getFlow: vi.fn(),
  updateFlow: vi.fn(),
  serviceErrorResponse: vi.fn(),
}));
vi.mock("@/lib/flows/delete-impact", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/flows/delete-impact")>()),
  loadFlowDeleteContext: mocks.load,
}));
vi.mock("@orchester/db", () => ({
  schema: { flows: { id: "id", workspaceId: "workspace_id", name: "name" } },
  getDb: () => ({
    delete: () => ({ where: () => ({ returning: mocks.returning }) }),
  }),
}));

const { DELETE } = await import("@/app/api/flows/[id]/route");
const { GET } = await import("@/app/api/flows/[id]/delete-impact/route");

const counts = { runs: 3, versions: 2, webhooks: 1, schedules: 0 };
const ctxFor = (over: Record<string, unknown> = {}) => ({
  flow: { id: "flow_a", name: "Flow A", enabled: false },
  agents: [],
  otherFlows: [],
  counts,
  ...over,
});
const call = (fn: typeof DELETE) =>
  fn(new Request("https://example.com", { method: "DELETE" }), {
    params: Promise.resolve({ id: "flow_a" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.returning.mockResolvedValue([{ id: "flow_a" }]);
});

describe("DELETE /api/flows/[id]", () => {
  it("refuses to delete an enabled flow", async () => {
    mocks.load.mockResolvedValue(ctxFor({ flow: { id: "flow_a", name: "Flow A", enabled: true } }));
    const res = await call(DELETE);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/pause/i);
    expect(mocks.returning).not.toHaveBeenCalled();
  });

  it("refuses when an agent is driven by the flow, naming it", async () => {
    mocks.load.mockResolvedValue(ctxFor({ agents: [{ id: "agent_1", name: "Agent One" }] }));
    const res = await call(DELETE);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Agent One");
    expect(body.agents).toEqual([{ id: "agent_1", name: "Agent One" }]);
    expect(mocks.returning).not.toHaveBeenCalled();
  });

  it("refuses when another flow references it in its nodes, naming it", async () => {
    mocks.load.mockResolvedValue(
      ctxFor({
        otherFlows: [
          { id: "flow_b", name: "Caller B", nodes: [{ id: "n1", config: { flowId: "flow_a" } }] },
          {
            id: "flow_c",
            name: "Unrelated C",
            nodes: [{ id: "n1", config: { flowId: "flow_z" } }],
          },
        ],
      })
    );
    const res = await call(DELETE);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Caller B");
    expect(body.error).not.toContain("Unrelated C");
    expect(body.flows).toEqual([{ id: "flow_b", name: "Caller B" }]);
  });

  it("deletes a clean, disabled flow and writes the audit log", async () => {
    mocks.load.mockResolvedValue(ctxFor());
    const res = await call(DELETE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.returning).toHaveBeenCalledTimes(1);
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_test",
        action: "flow.delete",
        resourceId: "flow_a",
        before: { name: "Flow A" },
      })
    );
  });

  it("returns 404 for a flow that is not in the workspace", async () => {
    mocks.load.mockResolvedValue(null);
    const res = await call(DELETE);
    expect(res.status).toBe(404);
    expect(mocks.returning).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("scopes the context lookup to the caller's workspace", async () => {
    mocks.load.mockResolvedValue(null);
    await call(DELETE);
    expect(mocks.load).toHaveBeenCalledWith("ws_test", "flow_a");
  });
});

describe("GET /api/flows/[id]/delete-impact", () => {
  const get = () =>
    GET(new Request("https://example.com"), { params: Promise.resolve({ id: "flow_a" }) });

  it("returns counts and no blockers for a clean flow", async () => {
    mocks.load.mockResolvedValue(ctxFor());
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      flow: { id: "flow_a", name: "Flow A" },
      counts,
      blockers: { enabled: false, agents: [], flows: [] },
    });
  });

  it("reports every blocker at once", async () => {
    mocks.load.mockResolvedValue(
      ctxFor({
        flow: { id: "flow_a", name: "Flow A", enabled: true },
        agents: [{ id: "agent_1", name: "Agent One" }],
        otherFlows: [{ id: "flow_b", name: "Caller B", nodes: [{ id: "n", flow: "flow_a" }] }],
      })
    );
    const body = await (await get()).json();
    expect(body.blockers).toEqual({
      enabled: true,
      agents: [{ id: "agent_1", name: "Agent One" }],
      flows: [{ id: "flow_b", name: "Caller B" }],
    });
  });

  it("returns 404 for another workspace's flow", async () => {
    mocks.load.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });
});
