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

const updateMock = vi.fn();
const insertMock = vi.fn();
const selectChainAgents = vi.fn();
const auditMock = vi.fn();

vi.mock("@orchester/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: selectChainAgents,
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
    agents: { id: "agent.id", workspaceId: "agent.ws", status: "agent.status" },
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
      executeTool(
        "agent_handoff",
        { agentId: "agent_sofia", note: "x" },
        baseCtx
      )
    ).rejects.toThrow(/cannot hand off to yourself/);
  });

  it("requiere conversationId (rechaza si no hay)", async () => {
    const noConvCtx: typeof baseCtx = { ...baseCtx };
    // Eliminar la prop así no chocamos con exactOptionalPropertyTypes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (noConvCtx as any).conversationId;
    await expect(
      executeTool(
        "agent_handoff",
        { agentId: "agent_elena", note: "x" },
        noConvCtx
      )
    ).rejects.toThrow(/requires conversationId/);
  });

  it("rechaza si target no existe en workspace", async () => {
    selectChainAgents.mockResolvedValueOnce([]); // no rows
    await expect(
      executeTool(
        "agent_handoff",
        { agentId: "agent_elena", note: "x" },
        baseCtx
      )
    ).rejects.toThrow(/not found in workspace/);
  });

  it("rechaza si target no está active", async () => {
    selectChainAgents.mockResolvedValueOnce([
      { id: "agent_elena", name: "Elena", role: "HR", status: "draft" },
    ]);
    await expect(
      executeTool(
        "agent_handoff",
        { agentId: "agent_elena", note: "x" },
        baseCtx
      )
    ).rejects.toThrow(/is not active/);
  });

  it("happy path: pivota agentId + escribe system message + audit log", async () => {
    selectChainAgents.mockResolvedValueOnce([
      { id: "agent_elena", name: "Elena HR Pro", role: "HR", status: "active" },
    ]);
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
