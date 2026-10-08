// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../../packages/db/src/schema";

const state = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>[]>(),
  writes: [] as {
    table: string;
    data?: Record<string, unknown> | undefined;
    where?: SQL | undefined;
  }[],
  predicates: [] as SQL[],
  execute: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@orchester/db", () => ({ getDb: () => db, schema }));
vi.mock("@/lib/mnemo/client", () => ({ getMnemoClient: vi.fn() }));
vi.mock("@/lib/audit/log", () => ({ appendAuditInTx: state.audit }));
vi.mock("@/lib/audit", () => ({ logAudit: state.audit }));
vi.mock("@/lib/tools", () => ({ listAllTools: () => [{ name: "calculator" }] }));
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: vi.fn(async () => ({ workspace: { id: "ws_a" }, user: { id: "user_a" } })),
  isAuthContext: (ctx: unknown) => !(ctx instanceof Response),
}));
vi.mock("@/lib/workspace", () => ({
  getCurrentWorkspace: vi.fn(async () => ({ workspace: { id: "ws_a" } })),
  getCurrentSession: vi.fn(async () => ({ user: { id: "user_a" } })),
}));

// Exercise the real handlers/services, replacing only database IO. Record
// predicates so missing tenant filters cannot be hidden by fixture results.
const db = {
  transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  execute: state.execute,
  select: () => ({
    from: (table: Parameters<typeof getTableName>[0]) => {
      const rows = state.rows.get(getTableName(table)) ?? [];
      const q = {
        where: (predicate: SQL) => {
          state.predicates.push(predicate);
          return q;
        },
        limit: (n: number) =>
          Object.assign(Promise.resolve(rows.slice(0, n)), {
            // `.for("update")` row locks resolve to the same rows.
            for: async () => rows.slice(0, n),
          }),
        groupBy: async () => rows,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return q;
    },
  }),
  update: (table: Parameters<typeof getTableName>[0]) => ({
    set: (data: Record<string, unknown>) => mutation(table, data),
  }),
  insert: (table: Parameters<typeof getTableName>[0]) => ({
    values: (data: Record<string, unknown>) => mutation(table, data),
  }),
  delete: (table: Parameters<typeof getTableName>[0]) => mutation(table),
};
function mutation(table: Parameters<typeof getTableName>[0], data?: Record<string, unknown>) {
  const name = getTableName(table);
  const entry = { table: name, data, where: undefined as SQL | undefined };
  state.writes.push(entry);
  const q = {
    where: (predicate: SQL) => {
      entry.where = predicate;
      state.predicates.push(predicate);
      return q;
    },
    returning: async () => [{ ...(state.rows.get(name)?.[0] ?? { id: "new_id" }), ...data }],
  };
  return q;
}
const agent = {
  id: "a1",
  name: "Helper",
  role: "Support",
  status: "draft",
  systemPrompt: "Keep this prompt",
  tools: [],
  teamId: null,
  kind: "conversational",
  flowId: null,
  model: "test-model",
};
const team = { id: "t1", name: "Support", description: "Keep description", avatarColor: "#123456" };
const flow = { id: "f1", name: "Workflow", enabled: false, nodes: [] };
const { callMcpTool, listMcpTools } = await import("@/lib/mcp/server");
const call = (name: string, input: Record<string, unknown>, scopes: string[] = []) =>
  callMcpTool(name, input, { workspaceId: "ws_a", keyId: "key_a", scopes });
const json = (r: Awaited<ReturnType<typeof call>>) => JSON.parse(r.content[0]!.text);

beforeEach(() => {
  state.rows.clear();
  state.writes.length = 0;
  state.predicates.length = 0;
  state.audit.mockReset();
  state.execute.mockReset();
  state.rows.set("agent", [{ ...agent }]);
  state.rows.set("team", [{ ...team }]);
  state.rows.set("flow", [{ ...flow }]);
});

const tools = [
  ["list_teams", "teams", "read", {}],
  ["create_team", "teams", "write", { name: "New team" }],
  ["update_team", "teams", "write", { teamId: "t1", name: "Renamed" }],
  ["delete_team", "teams", "delete", { teamId: "t1", confirm: "Support" }],
  ["get_agent", "agents", "read", { agentId: "a1" }],
  ["update_agent", "agents", "write", { agentId: "a1", teamId: "t1" }],
  ["delete_agent", "agents", "delete", { agentId: "a1", confirm: "Helper" }],
  ["get_flow_delete_impact", "flows", "read", { flowId: "f1" }],
  ["delete_flow", "flows", "delete", { flowId: "f1", confirm: "Workflow" }],
] as const;

describe("workspace administration over MCP", () => {
  it.each(tools)(
    "%s is discoverable and works with its explicit scope",
    async (name, domain, access, input) => {
      state.rows.set("agent", name.includes("agent") ? [{ ...agent }] : []);
      expect(listMcpTools().map((t) => t.name)).toContain(name);
      const r = await call(name, input, [`${domain}:${access}`]);
      expect(r.isError, r.content[0]?.text).toBeFalsy();
      if (access === "delete") {
        // Deleting an agent also removes its own memories, in the same transaction.
        expect(state.writes.map((w) => w.table)).toEqual(
          name === "delete_agent" ? ["agent", "agent_memory"] : [state.writes.at(-1)!.table]
        );
        expect(JSON.stringify(state.audit.mock.calls)).toContain(
          String((input as Record<string, unknown>).confirm)
        );
        expect(JSON.stringify(state.audit.mock.calls)).toContain("key_a");
      }
      const dialect = new PgDialect();
      for (const p of state.predicates) {
        const q = dialect.sqlToQuery(p);
        expect(q.sql).toContain("workspace_id");
        expect(q.params).toContain("ws_a");
      }
    }
  );
  for (const [name, domain, access, input] of tools.filter((t) => t[2] !== "read")) {
    it(`${name} refuses read-only keys before any IO`, async () => {
      const r = await call(name, input, [`${domain}:read`]);
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain(`${domain}:${access}`);
      expect(state.writes).toHaveLength(0);
      expect(state.predicates).toHaveLength(0);
    });
    if (access !== "delete") continue;
    for (const scopes of [[], ["write"], [`${domain}:write`]]) {
      it(`${name} refuses legacy/write scopes ${JSON.stringify(scopes)}`, async () => {
        const r = await call(name, input, scopes);
        expect(r.isError).toBe(true);
        expect(r.content[0]!.text).toContain(`${domain}:delete`);
        expect(state.writes).toHaveLength(0);
        expect(state.predicates).toHaveLength(0);
      });
    }
    it.each([undefined, "wrong", " " + input.confirm])(
      `${name} refuses a non-exact confirmation %s`,
      async (confirm) => {
        const r = await call(name, { ...input, confirm }, [`${domain}:delete`]);
        expect(r.isError).toBe(true);
        expect(r.content[0]!.text).toContain("confirm");
        expect(state.writes).toHaveLength(0);
        expect(state.audit).not.toHaveBeenCalled();
      }
    );
  }
  it("get_agent returns the complete config", async () => {
    expect(json(await call("get_agent", { agentId: "a1" }))).toMatchObject(agent);
  });
  it("list_teams returns agent counts", async () => {
    state.rows.set("agent", [{ teamId: "t1", count: 2 }]);
    expect(json(await call("list_teams", {}))).toMatchObject({
      teams: [{ ...team, agentCount: 2 }],
    });
  });
  it("update_agent changes only teamId and preserves the prompt", async () => {
    const r = await call("update_agent", { agentId: "a1", teamId: "t1" });
    expect(r.isError, r.content[0]?.text).toBeFalsy();
    expect(state.writes[0]?.data).toEqual({ teamId: "t1", updatedAt: expect.any(Date) });
    expect(json(r).systemPrompt).toBe(agent.systemPrompt);
  });
  it("update_agent accepts null to remove a team", async () => {
    expect((await call("update_agent", { agentId: "a1", teamId: null })).isError).toBeFalsy();
    expect(state.writes[0]?.data?.teamId).toBeNull();
  });
  it("update_agent rejects a team outside the workspace", async () => {
    state.rows.set("team", []);
    const r = await call("update_agent", { agentId: "a1", teamId: "other_team" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/team.*not found/i);
    expect(state.writes).toHaveLength(0);
  });
  it("update_agent rejects unknown tools", async () => {
    const r = await call("update_agent", { agentId: "a1", tools: ["unknown_tool"] });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("unknown_tool");
    expect(state.writes).toHaveLength(0);
  });
  it("update_agent accepts catalog tools", async () => {
    const r = await call("update_agent", { agentId: "a1", tools: ["calculator"] });
    expect(r.isError).toBeFalsy();
    expect(state.writes[0]?.data?.tools).toEqual(["calculator"]);
  });
  it("update_agent stores knowledge bases in config, keeping other keys", async () => {
    state.rows.set("agent", [{ ...agent, config: { keep: true } }]);
    state.rows.set("knowledge_base", [{ id: "kb1", name: "IT" }]);
    const r = await call("update_agent", { agentId: "a1", knowledgeBaseIds: ["kb1"] });
    expect(r.isError, r.content[0]?.text).toBeFalsy();
    expect(state.writes.at(-1)?.data).toEqual({
      config: { keep: true, knowledgeBaseIds: ["kb1"] },
      updatedAt: expect.any(Date),
    });
  });
  it("update_agent rejects knowledge bases that are not in the workspace", async () => {
    state.rows.set("knowledge_base", [{ id: "kb1", name: "IT" }]);
    const r = await call("update_agent", { agentId: "a1", knowledgeBaseIds: ["kb1", "foreign"] });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("foreign");
    expect(state.writes).toHaveLength(0);
  });
  it.each([{ name: " " }, { role: "" }, { status: "bogus" }, { maxTokens: "10" }, { tools: null }])(
    "update_agent validates %j",
    async (fields) => {
      const r = await call("update_agent", { agentId: "a1", ...fields });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).not.toContain("Unknown tool:");
      expect(state.writes).toHaveLength(0);
    }
  );
  it("update_agent sets maxToolCalls inside config, keeping the other config keys", async () => {
    state.rows.set("agent", [{ ...agent, config: { knowledgeBaseIds: ["kb1"], note: "x" } }]);
    const r = await call("update_agent", { agentId: "a1", maxToolCalls: 8 });
    expect(r.isError, r.content[0]?.text).toBeFalsy();
    expect(state.writes[0]?.data).toEqual({
      config: { knowledgeBaseIds: ["kb1"], note: "x", maxToolCalls: 8 },
      updatedAt: expect.any(Date),
    });
    expect(state.writes[0]?.data).not.toHaveProperty("maxToolCalls");
  });
  it("update_agent applies knowledge bases and maxToolCalls together without one dropping the other", async () => {
    // Both settings live in `config`; merging each from the stored value would
    // let the second overwrite the first.
    state.rows.set("agent", [{ ...agent, config: { keep: true } }]);
    state.rows.set("knowledge_base", [{ id: "kb1", name: "IT" }]);
    const r = await call("update_agent", {
      agentId: "a1",
      knowledgeBaseIds: ["kb1"],
      maxToolCalls: 9,
    });
    expect(r.isError, r.content[0]?.text).toBeFalsy();
    expect(state.writes.at(-1)?.data?.config).toEqual({
      keep: true,
      knowledgeBaseIds: ["kb1"],
      maxToolCalls: 9,
    });
  });
  it("update_agent creates config when the agent has none", async () => {
    state.rows.set("agent", [{ ...agent, config: null }]);
    await call("update_agent", { agentId: "a1", maxToolCalls: 15 });
    expect(state.writes[0]?.data?.config).toEqual({ maxToolCalls: 15 });
  });
  it("update_agent leaves config alone when maxToolCalls is not sent", async () => {
    await call("update_agent", { agentId: "a1", teamId: "t1" });
    expect(state.writes[0]?.data).not.toHaveProperty("config");
  });
  it.each([0, 16, 2.5, "8", null, -1])("update_agent rejects maxToolCalls %j", async (value) => {
    const r = await call("update_agent", { agentId: "a1", maxToolCalls: value });
    expect(r.isError).toBe(true);
    expect(state.writes).toHaveLength(0);
  });
  it("update_team is partial", async () => {
    const r = await call("update_team", { teamId: "t1", description: "Changed" });
    expect(r.isError).toBeFalsy();
    expect(state.writes[0]?.data).toEqual({ description: "Changed", updatedAt: expect.any(Date) });
  });
  it.each([{}, { name: " " }])("update_team rejects an empty update %j", async (fields) => {
    const r = await call("update_team", { teamId: "t1", ...fields });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).not.toContain("Unknown tool:");
    expect(state.writes).toHaveLength(0);
  });
  it.each(["agent", "channel"])("delete_team lists blocking %s names", async (table) => {
    state.rows.set("agent", []);
    state.rows.set(table, [{ id: "blocker", name: "Assigned resource" }]);
    const r = await call("delete_team", { teamId: "t1", confirm: "Support" }, ["teams:delete"]);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("Assigned resource");
    expect(state.writes).toHaveLength(0);
  });
  it("delete_agent refuses active agents", async () => {
    state.rows.set("agent", [{ ...agent, status: "active" }]);
    const r = await call("delete_agent", { agentId: "a1", confirm: "Helper" }, ["agents:delete"]);
    expect(r.content[0]!.text).toContain("active");
    expect(r.isError).toBe(true);
    expect(state.writes).toHaveLength(0);
  });
  it.each([
    ["flow", { ...flow, name: "Caller", nodes: [{ type: "agent", config: { agentId: "a1" } }] }],
    ["channel", { id: "c1", name: "Inbound" }],
    ["employee", { id: "e1", name: "Operator", assignedAgentIds: ["a1"] }],
  ])("delete_agent lists blocking %s references", async (table, row) => {
    state.rows.set(table as string, [row as Record<string, unknown>]);
    const r = await call("delete_agent", { agentId: "a1", confirm: "Helper" }, ["agents:delete"]);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain((row as { name: string }).name);
    expect(state.writes).toHaveLength(0);
  });
  it("delete_agent is not blocked by the agent's own memories and removes them", async () => {
    state.rows.set("agent_memory", [{ id: "m1" }]);
    const r = await call("delete_agent", { agentId: "a1", confirm: "Helper" }, ["agents:delete"]);
    expect(r.isError, r.content[0]?.text).toBeFalsy();
    expect(state.writes.map((w) => w.table)).toEqual(["agent", "agent_memory"]);
  });
  it.each(["enabled", "agent", "flow"])("delete_flow reuses %s blockers", async (blocker) => {
    state.rows.set("agent", []);
    if (blocker === "enabled") state.rows.set("flow", [{ ...flow, enabled: true }]);
    if (blocker === "agent") state.rows.set("agent", [{ id: "a2", name: "Dependent agent" }]);
    if (blocker === "flow")
      state.rows.set("flow", [{ ...flow, name: "Caller", nodes: [{ config: { flowId: "f1" } }] }]);
    const r = await call(
      "delete_flow",
      { flowId: "f1", confirm: blocker === "flow" ? "Caller" : "Workflow" },
      ["flows:delete"]
    );
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain(
      blocker === "enabled" ? "enabled" : blocker === "agent" ? "Dependent agent" : "Caller"
    );
    expect(state.writes).toHaveLength(0);
  });
  it("flow delete impact reports cascade counts", async () => {
    state.rows.set("flow_run", [{ n: 3 }]);
    const r = await call("get_flow_delete_impact", { flowId: "f1" }, ["flows:read"]);
    expect(r.isError).toBeFalsy();
    expect(json(r)).toMatchObject({ counts: { runs: 3, versions: 0, schedules: 0, webhooks: 0 } });
  });
});

describe("team REST routes", () => {
  it("PATCH name preserves description and avatar color", async () => {
    const { PATCH } = await import("@/app/api/teams/[id]/route");
    const r = await PATCH(
      new Request("https://example.com/api/teams/t1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed" }),
      }),
      { params: Promise.resolve({ id: "t1" }) }
    );
    expect(r.status).toBe(200);
    expect(state.writes[0]?.data).toEqual({ name: "Renamed", updatedAt: expect.any(Date) });
  });
  it("PATCH description does not require name", async () => {
    const { PATCH } = await import("@/app/api/teams/[id]/route");
    const r = await PATCH(
      new Request("https://example.com/api/teams/t1", {
        method: "PATCH",
        body: JSON.stringify({ description: "New description" }),
      }),
      { params: Promise.resolve({ id: "t1" }) }
    );
    expect(r.status).toBe(200);
    expect(state.writes[0]?.data).toEqual({
      description: "New description",
      updatedAt: expect.any(Date),
    });
  });
  it("PATCH requires at least one field", async () => {
    const { PATCH } = await import("@/app/api/teams/[id]/route");
    const r = await PATCH(
      new Request("https://example.com/api/teams/t1", { method: "PATCH", body: "{}" }),
      { params: Promise.resolve({ id: "t1" }) }
    );
    expect(r.status).toBe(400);
    expect(state.writes).toHaveLength(0);
  });
  it("GET teams returns the same data as MCP", async () => {
    const routes = await import("@/app/api/teams/route");
    expect(routes).toHaveProperty("GET");
    const r = await (routes as typeof routes & { GET: () => Promise<Response> }).GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(json(await call("list_teams", {})));
  });
});

describe("administration transaction context", () => {
  it("uses the unprivileged tenant role for MCP", async () => {
    await call("get_agent", { agentId: "a1" });
    const statements = state.execute.mock.calls.map(([query]) => new PgDialect().sqlToQuery(query));
    expect(statements[0]?.sql).toBe("SET LOCAL ROLE app_user");
    expect(
      statements.some((q) => q.sql.includes("app.workspace_id") && q.params.includes("ws_a"))
    ).toBe(true);
  });
});

describe("deletion preconditions at mutation time", () => {
  it.each([
    ["delete_team", "teams", { teamId: "t1", confirm: "Support" }],
    ["delete_agent", "agents", { agentId: "a1", confirm: "Helper" }],
    ["delete_flow", "flows", { flowId: "f1", confirm: "Workflow" }],
  ] as const)(
    "%s cannot bypass confirmation after a concurrent rename",
    async (tool, domain, input) => {
      if (domain !== "agents") state.rows.set("agent", []);
      const result = await call(tool, input, [`${domain}:delete`]);
      expect(result.isError).toBeFalsy();
      const where = new PgDialect().sqlToQuery(state.writes[0]!.where!);
      expect(where.sql).toContain('"name"');
      expect(where.params).toContain(input.confirm);
      if (domain === "agents") {
        expect(where.sql).toContain('"status"');
        expect(where.params).toContain("draft");
      }
      if (domain === "flows") {
        expect(where.sql).toContain('"enabled"');
        expect(where.params).toContain(false);
      }
    }
  );
});
