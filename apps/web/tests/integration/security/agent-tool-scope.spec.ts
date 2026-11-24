// EXEC-005: an agent reaches only the integrations and flows assigned to it
// (agent.config.allowedIntegrationIds / allowedFlowIds) through
// run_integration and flow_call, on every path that runs an agent.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import { createId } from "@paralleldrive/cuid2";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

const h = vi.hoisted(() => ({ run: vi.fn(), llm: vi.fn() }));
// The integration itself never runs for real: the spy says whether it was reached.
vi.mock("@/lib/integrations/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/integrations/store")>()),
  runIntegrationAction: h.run,
}));
vi.mock("@/lib/llm-call", () => ({ llmCall: h.llm }));
vi.mock("@/lib/workspace", async (orig) => ({
  ...(await orig<typeof import("@/lib/workspace")>()),
  getCurrentSession: vi.fn(),
  getCurrentWorkspace: vi.fn(),
}));

let wsA: WsFixture;
let wsB: WsFixture;
let tools: typeof import("@/lib/tools");
let scope: typeof import("@/lib/agents/tool-scope");
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;
let and: typeof import("drizzle-orm").and;

const A = `int_a_${createId()}`;
const B = `int_b_${createId()}`;
const ODOO = `int_odoo_${createId()}`;
const FOREIGN = `int_x_${createId()}`;
const F1 = `flow_1_${createId()}`;
const F2 = `flow_2_${createId()}`;
let agentId: string;

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
  tools = await import("@/lib/tools");
  scope = await import("@/lib/agents/tool-scope");
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq, and } = await import("drizzle-orm"));
  const db = getDb();
  const integ = (id: string, workspaceId: string, type: string) => ({
    id,
    workspaceId,
    type,
    name: id,
    configEncrypted: "x",
    enabled: true,
  });
  await db
    .insert(schema.workspaceIntegrations)
    .values([
      integ(A, wsA.id, "http"),
      integ(B, wsA.id, "resend"),
      integ(ODOO, wsA.id, "odoo"),
      integ(FOREIGN, wsB.id, "http"),
    ] as never);
  await db.insert(schema.flows).values([
    { id: F1, workspaceId: wsA.id, name: "Allowed" },
    { id: F2, workspaceId: wsA.id, name: "Not allowed" },
  ] as never);
  agentId = wsA.agentIds[0]!;
  await db
    .update(schema.agents)
    .set({
      tools: ["run_integration", "flow_call"],
      config: { allowedIntegrationIds: [A], allowedFlowIds: [F1] },
    })
    .where(eq(schema.agents.id, agentId));
}, 90_000);
afterAll(() => teardownTestWorkspaces());

beforeEach(() => {
  h.run.mockReset().mockResolvedValue({ ok: true });
  h.llm.mockReset();
});

const ctx = () => ({ workspaceId: wsA.id, variables: {}, agentId });

describe("run_integration", () => {
  it("refuses an integration that is not assigned, without running it", async () => {
    await expect(
      tools.executeTool("run_integration", { integrationId: B, action: "send_email" }, ctx())
    ).rejects.toBeInstanceOf(scope.ToolScopeError);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("refuses a connector type whose row is not assigned", async () => {
    await expect(
      tools.executeTool("run_integration", { integrationId: "odoo", action: "search_tasks" }, ctx())
    ).rejects.toBeInstanceOf(scope.ToolScopeError);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("runs an assigned integration", async () => {
    await tools.executeTool("run_integration", { integrationId: A, action: "request" }, ctx());
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("the dry run classification refuses it the same way", async () => {
    await expect(
      tools.toolEffect("run_integration", { integrationId: B, action: "send_email" }, ctx())
    ).rejects.toBeInstanceOf(scope.ToolScopeError);
  });

  it("logs the refusal as refused with code tool_scope", async () => {
    await tools
      .executeTool("run_integration", { integrationId: B, action: "send_email" }, ctx())
      .catch(() => {});
    const rows = await getDb()
      .select()
      .from(schema.toolCalls)
      .where(and(eq(schema.toolCalls.workspaceId, wsA.id), eq(schema.toolCalls.agentId, agentId)));
    expect(rows.at(-1)).toMatchObject({ outcome: "refused", errorCode: "tool_scope" });
  });
});

describe("flow_call", () => {
  it("refuses a flow that is not assigned and queues no run", async () => {
    await expect(tools.executeTool("flow_call", { flowId: F2 }, ctx())).rejects.toBeInstanceOf(
      scope.ToolScopeError
    );
    const runs = await getDb().select().from(schema.flowRuns).where(eq(schema.flowRuns.flowId, F2));
    expect(runs).toHaveLength(0);
  });
});

describe("resolveToolDefinitions", () => {
  it("offers only the assigned ids", async () => {
    const defs = await tools.resolveToolDefinitions(
      wsA.id,
      ["run_integration", "flow_call"],
      undefined,
      { id: agentId, config: { allowedIntegrationIds: [A, FOREIGN], allowedFlowIds: [F1] } }
    );
    const prop = (name: string, key: string) =>
      (
        defs.find((d) => d.name === name)!.inputSchema as {
          properties: Record<string, { enum?: string[] }>;
        }
      ).properties[key]!;
    // A foreign id stored in the config is not offered.
    expect(prop("run_integration", "integrationId").enum).toEqual([A]);
    expect(prop("flow_call", "flowId").enum).toEqual([F1]);
  });

  it("drops both tools when nothing is assigned", async () => {
    const defs = await tools.resolveToolDefinitions(
      wsA.id,
      ["run_integration", "flow_call", "calculator"],
      undefined,
      { id: agentId, config: {} }
    );
    expect(defs.map((d) => d.name)).toEqual(["calculator"]);
  });
});

describe("every agent loop refuses the same way", () => {
  // The model asks for B; the loop runs the tool and feeds the error back.
  const llmAsksForB = () =>
    h.llm
      .mockResolvedValueOnce({
        content: "",
        model: "gpt-4o",
        tokensUsed: 1,
        toolCalls: [
          {
            id: "t1",
            name: "run_integration",
            input: { integrationId: B, action: "send_email" },
          },
        ],
      })
      .mockResolvedValue({ content: "done", model: "gpt-4o", tokensUsed: 1, toolCalls: [] });

  const lastRefusal = async (source: string) => {
    const rows = await getDb()
      .select()
      .from(schema.toolCalls)
      .where(
        and(
          eq(schema.toolCalls.workspaceId, wsA.id),
          eq(schema.toolCalls.agentId, agentId),
          eq(schema.toolCalls.source, source)
        )
      );
    return rows.at(-1);
  };

  const agentRow = async () =>
    (await getDb().select().from(schema.agents).where(eq(schema.agents.id, agentId)))[0]!;

  it("runAgent", async () => {
    llmAsksForB();
    const { runAgent } = await import("@/lib/agent-runtime");
    await runAgent({
      workspaceId: wsA.id,
      agent: (await agentRow()) as never,
      messages: [{ role: "user", content: "go" }],
      testChat: true,
    } as never).catch(() => {});
    expect(h.run).not.toHaveBeenCalled();
    expect(await lastRefusal("test_chat")).toMatchObject({
      tool: "run_integration",
      outcome: "refused",
      errorCode: "tool_scope",
    });
  });

  it("the channel router", async () => {
    llmAsksForB();
    const channelId = createId();
    await getDb()
      .insert(schema.channels)
      .values({
        id: channelId,
        workspaceId: wsA.id,
        agentId,
        name: "scope",
        type: "web",
        status: "active",
      } as never);
    const { handleInbound } = await import("@/lib/channels/router");
    await handleInbound(wsA.id, { channelId, externalId: createId(), text: "go" }).catch(() => {});
    expect(h.run).not.toHaveBeenCalled();
    expect(await lastRefusal("channel")).toMatchObject({
      tool: "run_integration",
      outcome: "refused",
      errorCode: "tool_scope",
    });
  });

  it("a flow agent step", async () => {
    llmAsksForB();
    const flowId = createId();
    await getDb()
      .insert(schema.flows)
      .values({
        id: flowId,
        workspaceId: wsA.id,
        name: "With agent",
        enabled: true,
        nodes: [
          { id: "t", type: "trigger", config: {}, label: "t", position: { x: 0, y: 0 } },
          { id: "a", type: "agent", config: { agentId }, label: "a", position: { x: 0, y: 0 } },
        ],
        edges: [{ id: "e", source: "t", target: "a" }],
      } as never);
    const { executeFlow } = await import("@/lib/flow-engine");
    await executeFlow({
      flowId,
      workspaceId: wsA.id,
      triggerSource: "test",
      input: { message: "go" },
    }).catch(() => {});
    expect(h.run).not.toHaveBeenCalled();
    expect(await lastRefusal("flow_agent")).toMatchObject({
      tool: "run_integration",
      outcome: "refused",
      errorCode: "tool_scope",
    });
  });
});

describe("PATCH /api/agents/[id]", () => {
  const patch = async (body: Record<string, unknown>) => {
    const ws = await import("@/lib/workspace");
    (ws.getCurrentSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: wsA.ownerId, email: wsA.ownerEmail, name: "o" },
    });
    (ws.getCurrentWorkspace as ReturnType<typeof vi.fn>).mockResolvedValue({
      workspace: { id: wsA.id, slug: wsA.slug, name: "A" },
      role: "owner",
    });
    const { PATCH } = await import("@/app/api/agents/[id]/route");
    return PATCH(
      new Request(`http://x/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "n", role: "r", ...body }),
      }),
      { params: Promise.resolve({ id: agentId }) }
    );
  };

  it("rejects an integration of another workspace", async () => {
    const res = await patch({ allowedIntegrationIds: [A, FOREIGN] });
    expect(res.status).toBe(400);
  });

  it("rejects a flow of another workspace", async () => {
    const foreignFlow = createId();
    await getDb()
      .insert(schema.flows)
      .values({ id: foreignFlow, workspaceId: wsB.id, name: "B" } as never);
    const res = await patch({ allowedFlowIds: [foreignFlow] });
    expect(res.status).toBe(400);
  });

  it("stores valid lists in config and keeps the other keys", async () => {
    const res = await patch({ allowedIntegrationIds: [A, ODOO], allowedFlowIds: [] });
    expect(res.status).toBe(200);
    const [row] = await getDb().select().from(schema.agents).where(eq(schema.agents.id, agentId));
    expect(row!.config).toMatchObject({ allowedIntegrationIds: [A, ODOO], allowedFlowIds: [] });
    // restore for any later test
    await patch({ allowedIntegrationIds: [A], allowedFlowIds: [F1] });
  });
});

describe("admin service (MCP admin tools) sets the scope lists", () => {
  const actor = () => ({ kind: "user" as const, workspaceId: wsA.id, userId: wsA.ownerId });
  const update = async (input: Record<string, unknown>) => {
    const { updateAgent } = await import("@/lib/agents/admin-service");
    return updateAgent(actor(), agentId, input);
  };

  it("refuses an integration or flow of another workspace", async () => {
    await expect(update({ allowedIntegrationIds: [A, FOREIGN] })).rejects.toThrow(/integration/i);
    const foreignFlow = createId();
    await getDb()
      .insert(schema.flows)
      .values({ id: foreignFlow, workspaceId: wsB.id, name: "B2" } as never);
    await expect(update({ allowedFlowIds: [foreignFlow] })).rejects.toThrow(/flow/i);
  });

  it("merges valid lists into config, keeping the other keys", async () => {
    await update({ allowedIntegrationIds: [A, ODOO], allowedFlowIds: [F2], maxToolCalls: 7 });
    const [row] = await getDb().select().from(schema.agents).where(eq(schema.agents.id, agentId));
    expect(row!.config).toMatchObject({
      allowedIntegrationIds: [A, ODOO],
      allowedFlowIds: [F2],
      maxToolCalls: 7,
    });
    await update({ allowedIntegrationIds: [A], allowedFlowIds: [F1] });
  });
});
