import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests del tool `agent_handoff` y `agent_team_list`.
 *
 * Mockean db + audit + cuid2 para validar la lógica sin DB live:
 *   - rechazo de self-handoff
 *   - rechazo de target en otro workspace
 *   - rechazo de target inactive
 *   - happy path: pivota agentId, persiste system message, escribe audit log
 */

// `vi.mock(...)` calls are hoisted to the top of the file by vitest.
// Wrapping the mock factories in `vi.hoisted(...)` keeps the spies
// available at hoist-time, otherwise they live in the temporal dead
// zone and the file fails to load with
// `ReferenceError: Cannot access 'auditMock' before initialization`.
const { updateMock, insertMock, selectChainAgents, listMock, auditMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  listMock: vi.fn(),
  insertMock: vi.fn(),
  selectChainAgents: vi.fn(),
  auditMock: vi.fn(),
}));

vi.mock("@orchester/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        // `.where(...).limit(n)` resolves via selectChainAgents (single-row
        // lookups); awaiting `.where(...)` directly resolves via listMock.
        where: (cond: unknown) => ({
          limit: selectChainAgents,
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(listMock(cond)).then(res, rej),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: updateMock,
      }),
    }),
    insert: () => ({
      values: insertMock,
    }),
  }),
  schema: {
    agents: {
      id: "agent.id",
      workspaceId: "agent.ws",
      status: "agent.status",
      teamId: "agent.team",
    },
    conversations: { id: "conv.id" },
    messages: {},
  },
}));

vi.mock("@paralleldrive/cuid2", () => ({
  createId: () => "test_id_xyz",
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  and: (...xs: unknown[]) => ({ and: xs }),
  ne: (a: unknown, b: unknown) => ({ ne: [a, b] }),
}));

vi.mock("../lib/audit", () => ({
  logAudit: auditMock,
}));

import { executeTool } from "../lib/tools";

beforeEach(() => {
  updateMock.mockReset();
  insertMock.mockReset();
  selectChainAgents.mockReset();
  listMock.mockReset();
  auditMock.mockReset();
});

describe("agent_handoff", () => {
  const baseCtx = {
    workspaceId: "ws_1",
    variables: {},
    agentId: "agent_sofia",
    conversationId: "conv_abc",
  };

  it("rechaza self-handoff", async () => {
    await expect(
      executeTool("agent_handoff", { agentId: "agent_sofia", note: "x" }, baseCtx)
    ).rejects.toThrow(/cannot hand off to yourself/);
  });

  it("requiere conversationId (rechaza si no hay)", async () => {
    const noConvCtx: typeof baseCtx = { ...baseCtx };
    // Eliminar la prop así no chocamos con exactOptionalPropertyTypes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (noConvCtx as any).conversationId;
    await expect(
      executeTool("agent_handoff", { agentId: "agent_elena", note: "x" }, noConvCtx)
    ).rejects.toThrow(/requires conversationId/);
  });

  it("rechaza si target no existe en workspace", async () => {
    selectChainAgents.mockResolvedValueOnce([]); // no rows
    await expect(
      executeTool("agent_handoff", { agentId: "agent_elena", note: "x" }, baseCtx)
    ).rejects.toThrow(/not found in workspace/);
  });

  it("rechaza si target no está active", async () => {
    selectChainAgents.mockResolvedValueOnce([
      { id: "agent_elena", name: "Elena", role: "HR", status: "draft" },
    ]);
    await expect(
      executeTool("agent_handoff", { agentId: "agent_elena", note: "x" }, baseCtx)
    ).rejects.toThrow(/is not active/);
  });

  it("happy path: pivota agentId + escribe system message + audit log", async () => {
    selectChainAgents.mockResolvedValueOnce([
      { id: "agent_elena", name: "Elena HR Pro", role: "HR", status: "active", teamId: null },
    ]);
    selectChainAgents.mockResolvedValueOnce([{ teamId: null }]); // caller
    const result = (await executeTool(
      "agent_handoff",
      { agentId: "agent_elena", note: "Caso supera mi límite" },
      baseCtx
    )) as { ok: boolean; handedOffTo: { id: string; name: string } };

    expect(result.ok).toBe(true);
    expect(result.handedOffTo.id).toBe("agent_elena");
    expect(updateMock).toHaveBeenCalledTimes(1); // pivot conversation.agentId
    expect(insertMock).toHaveBeenCalledTimes(1); // system message
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "agent.handoff",
        resource: "conversation",
        resourceId: "conv_abc",
        after: expect.objectContaining({
          fromAgentId: "agent_sofia",
          toAgentId: "agent_elena",
        }),
      })
    );
  });
});

describe("team scoping", () => {
  const ctx = {
    workspaceId: "ws_1",
    variables: {},
    agentId: "agent_sofia",
    conversationId: "conv_abc",
  };
  const target = (teamId: string | null) => ({
    id: "agent_elena",
    name: "Elena",
    role: "HR",
    status: "active",
    teamId,
  });

  it("agent_team_list: a team member sees only active agents of its team", async () => {
    selectChainAgents.mockResolvedValueOnce([{ teamId: "team_a" }]); // caller
    listMock.mockResolvedValueOnce([{ id: "agent_elena", name: "Elena", teamId: "team_a" }]);
    const res = (await executeTool("agent_team_list", {}, ctx)) as {
      teammates: { id: string }[];
    };
    expect(res.teammates.map((t) => t.id)).toEqual(["agent_elena"]);
    const cond = JSON.stringify(listMock.mock.calls[0]![0]);
    expect(cond).toContain("team_a");
    expect(cond).toContain("agent_sofia"); // excluded via ne
    expect(cond).toContain("active");
  });

  it("agent_team_list: alone in its team gets an empty list, no workspace fallback", async () => {
    selectChainAgents.mockResolvedValueOnce([{ teamId: "team_a" }]);
    listMock.mockResolvedValueOnce([]);
    const res = (await executeTool("agent_team_list", {}, ctx)) as { teammates: unknown[] };
    expect(res.teammates).toEqual([]);
    expect(JSON.stringify(listMock.mock.calls[0]![0])).toContain("team_a");
  });

  it("agent_team_list: an agent without a team sees the whole workspace", async () => {
    selectChainAgents.mockResolvedValueOnce([{ teamId: null }]);
    listMock.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
    const res = (await executeTool("agent_team_list", {}, ctx)) as { teammates: unknown[] };
    expect(res.teammates).toHaveLength(2);
    expect(JSON.stringify(listMock.mock.calls[0]![0])).not.toContain("agent.team");
  });

  it("agent_handoff: succeeds to a same-team agent", async () => {
    selectChainAgents.mockResolvedValueOnce([target("team_a")]);
    selectChainAgents.mockResolvedValueOnce([{ teamId: "team_a" }]);
    const res = (await executeTool(
      "agent_handoff",
      { agentId: "agent_elena", note: "x" },
      ctx
    )) as {
      ok: boolean;
    };
    expect(res.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("agent_handoff: rejects another team's agent and writes nothing", async () => {
    selectChainAgents.mockResolvedValueOnce([target("team_b")]);
    selectChainAgents.mockResolvedValueOnce([{ teamId: "team_a" }]);
    await expect(
      executeTool("agent_handoff", { agentId: "agent_elena", note: "x" }, ctx)
    ).rejects.toThrow(/Elena is not in your team/);
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("agent_handoff: a caller without a team can hand off to any active agent", async () => {
    selectChainAgents.mockResolvedValueOnce([target("team_b")]);
    selectChainAgents.mockResolvedValueOnce([{ teamId: null }]);
    const res = (await executeTool(
      "agent_handoff",
      { agentId: "agent_elena", note: "x" },
      ctx
    )) as {
      ok: boolean;
    };
    expect(res.ok).toBe(true);
  });
});

describe("test chat simulation", () => {
  // The agent page's test chat has no conversation: it sets an explicit flag.
  const testCtx = {
    workspaceId: "ws_1",
    variables: {},
    agentId: "agent_sofia",
    testChat: true,
  };
  const target = (over: Record<string, unknown> = {}) => ({
    id: "agent_elena",
    name: "Elena",
    role: "HR",
    status: "active",
    teamId: "team_a",
    ...over,
  });

  it("returns a simulated result with name and role and persists nothing", async () => {
    selectChainAgents.mockResolvedValueOnce([target()]);
    selectChainAgents.mockResolvedValueOnce([{ teamId: "team_a" }]);
    const res = (await executeTool(
      "agent_handoff",
      { agentId: "agent_elena", note: "needs HR" },
      testCtx
    )) as {
      simulated: boolean;
      wouldHandOffTo: { id: string; name: string; role: string };
      note: string;
      instruction: string;
    };
    expect(res.simulated).toBe(true);
    expect(res.wouldHandOffTo).toEqual({ id: "agent_elena", name: "Elena", role: "HR" });
    expect(res.note).toBe("needs HR");
    expect(res.instruction).toMatch(/test chat/i);
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("without the flag and without conversationId it still fails", async () => {
    const { testChat: _omit, ...noFlag } = testCtx;
    await expect(
      executeTool("agent_handoff", { agentId: "agent_elena", note: "x" }, noFlag)
    ).rejects.toThrow(/requires conversationId/);
  });

  it("unknown target still errors in the test chat", async () => {
    selectChainAgents.mockResolvedValueOnce([]);
    await expect(
      executeTool("agent_handoff", { agentId: "agent_elena", note: "x" }, testCtx)
    ).rejects.toThrow(/not found in workspace/);
  });

  it("inactive target still errors in the test chat", async () => {
    selectChainAgents.mockResolvedValueOnce([target({ status: "draft" })]);
    await expect(
      executeTool("agent_handoff", { agentId: "agent_elena", note: "x" }, testCtx)
    ).rejects.toThrow(/is not active/);
  });

  it("another team's agent still errors in the test chat", async () => {
    selectChainAgents.mockResolvedValueOnce([target({ teamId: "team_b" })]);
    selectChainAgents.mockResolvedValueOnce([{ teamId: "team_a" }]);
    await expect(
      executeTool("agent_handoff", { agentId: "agent_elena", note: "x" }, testCtx)
    ).rejects.toThrow(/Elena is not in your team/);
  });

  it("self-handoff still errors in the test chat", async () => {
    await expect(
      executeTool("agent_handoff", { agentId: "agent_sofia", note: "x" }, testCtx)
    ).rejects.toThrow(/cannot hand off to yourself/);
  });
});
