// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ lock: vi.fn(), set: vi.fn(), txs: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/teams/service", () => ({ requireTeam: vi.fn() }));
vi.mock("@/lib/agents/delete-impact", () => ({
  agentDeleteBlockers: vi.fn(),
  agentBlockersMessage: vi.fn(),
}));
vi.mock("@orchester/db", () => ({
  schema: { agents: { id: "id", workspaceId: "w", config: "c" } },
}));
vi.mock("@/lib/workspace-admin", () => {
  class AdminError extends Error {}
  const chain = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = () => q;
    q.limit = () => q;
    q.for = (mode: string) => {
      state.lock(mode);
      return Promise.resolve(rows);
    };
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return q;
  };
  const tx = {
    select: () => chain([{ id: "a1", name: "n", config: { keep: 1 } }]),
    update: () => ({
      set: (d: unknown) => {
        state.set(d);
        return { where: () => ({ returning: async () => [{ id: "a1", name: "n" }] }) };
      },
    }),
  };
  return {
    AdminError,
    auditAdmin: vi.fn(),
    confirmName: vi.fn(),
    withAdminTx: async (_a: unknown, fn: (t: unknown) => unknown) => {
      state.txs++;
      return fn(tx);
    },
  };
});

const { updateAgent } = await import("@/lib/agents/admin-service");
const actor = { kind: "user", workspaceId: "ws_a", userId: "u" } as never;

beforeEach(() => {
  state.lock.mockReset();
  state.set.mockReset();
  state.txs = 0;
});

describe("admin updateAgent config merge", () => {
  it("reads the agent FOR UPDATE and merges onto that locked read", async () => {
    await updateAgent(actor, "a1", { maxToolCalls: 9 });
    expect(state.txs).toBe(1);
    expect(state.lock).toHaveBeenCalledWith("update");
    expect(state.set.mock.calls[0]![0].config).toMatchObject({ keep: 1, maxToolCalls: 9 });
  });
});
