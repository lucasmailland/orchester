// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  kbs: [] as { id: string; name: string }[],
  set: vi.fn(),
  lock: vi.fn(),
  txs: 0,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: vi.fn(async () => ({ workspace: { id: "ws_a" }, user: { id: "u" } })),
  isAuthContext: () => true,
}));
vi.mock("@/lib/workspace", () => ({ getCurrentWorkspace: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/agents/admin-service", () => ({ deleteAgent: vi.fn() }));
vi.mock("@/lib/agents/knowledge-bases", async (orig) => ({
  ...(await orig<typeof import("@/lib/agents/knowledge-bases")>()),
  unknownKbIds: async (_ws: string, ids: string[]) =>
    ids.filter((id) => !state.kbs.some((k) => k.id === id)),
}));
// The read-modify-write of `config` must run in one transaction, reading the
// row with FOR UPDATE; the fake tx records both.
vi.mock("@/lib/workspace-admin", () => {
  const chain = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = () => q;
    q.limit = () => q;
    q.for = (mode: string) => {
      state.lock(mode);
      return Promise.resolve(rows);
    };
    return q;
  };
  const tx = {
    select: () => chain([{ config: { keep: 1 } }]),
    update: () => ({
      set: (d: unknown) => {
        state.set(d);
        return { where: () => ({ returning: async () => [{ id: "a1", name: "n", role: "r" }] }) };
      },
    }),
  };
  return {
    withAdminTx: async (_actor: unknown, fn: (t: unknown) => unknown) => {
      state.txs++;
      return fn(tx);
    },
    adminErrorResponse: (e: unknown) => {
      throw e;
    },
  };
});
vi.mock("@orchester/db", () => ({
  schema: { agents: { id: "id", workspaceId: "w", config: "c" } },
  getDb: () => {
    throw new Error("the PATCH must go through the transaction");
  },
}));

const { PATCH } = await import("@/app/api/agents/[id]/route");
const patch = (body: Record<string, unknown>) =>
  PATCH(
    new Request("http://x/api/agents/a1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "n", role: "r", ...body }),
    }),
    { params: Promise.resolve({ id: "a1" }) }
  );

beforeEach(() => {
  state.set.mockReset();
  state.lock.mockReset();
  state.txs = 0;
  state.kbs = [{ id: "kb1", name: "IT" }];
});

describe("PATCH /api/agents/[id] knowledgeBaseIds", () => {
  it("rejects ids that are not knowledge bases of the workspace", async () => {
    const res = await patch({ knowledgeBaseIds: ["kb1", "nope"] });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("nope");
    expect(state.set).not.toHaveBeenCalled();
  });
  it("stores valid ids in config without dropping other keys", async () => {
    const res = await patch({ knowledgeBaseIds: ["kb1"] });
    expect(res.status).toBe(200);
    expect(state.set.mock.calls[0]![0].config).toEqual({ keep: 1, knowledgeBaseIds: ["kb1"] });
  });
  it("leaves config alone when the field is absent", async () => {
    await patch({});
    expect(state.set.mock.calls[0]![0]).not.toHaveProperty("config");
  });
});

describe("PATCH /api/agents/[id] concurrent config updates", () => {
  it("reads config FOR UPDATE inside the same transaction as the write", async () => {
    await patch({ maxToolCalls: 7 });
    expect(state.txs).toBe(1);
    expect(state.lock).toHaveBeenCalledWith("update");
    // merged onto the row read under the lock, keeping the other keys
    expect(state.set.mock.calls[0]![0].config).toMatchObject({ keep: 1, maxToolCalls: 7 });
  });
});
