// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../../packages/db/src/schema";

const state = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>[]>(),
  search: vi.fn(),
}));
vi.mock("@orchester/db", () => ({ getDb: () => db, schema }));
vi.mock("@/lib/knowledge-search", () => ({ searchKnowledgeBase: state.search }));

// Fake db that honours the workspace and id predicates by reading the bound
// parameters, so a missing tenant filter shows up as a cross-workspace leak.
const dialect = new PgDialect();
const db = {
  select: () => ({
    from: (table: Parameters<typeof getTableName>[0]) => {
      const all = state.rows.get(getTableName(table)) ?? [];
      let rows = all;
      const q = {
        where: (predicate: SQL) => {
          const params = dialect.sqlToQuery(predicate).params;
          const inWorkspace = all.filter((r) => params.includes(r.workspaceId));
          rows = inWorkspace.filter((r) => params.includes(r.id));
          return q;
        },
        limit: async (n: number) => rows.slice(0, n),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return q;
    },
  }),
};

const { executeTool, resolveToolDefinitions } = await import("@/lib/tools");
const ctx = { workspaceId: "ws_1", variables: {}, agentId: "agent_kb" };

const hit = (id: string, score: number) => ({
  id,
  docId: "d",
  ordinal: 0,
  text: id,
  docTitle: "t",
  score,
});

beforeEach(() => {
  state.rows.clear();
  state.search.mockReset();
  state.rows.set("knowledge_base", [
    { id: "kb_a", workspaceId: "ws_1", name: "IT" },
    { id: "kb_b", workspaceId: "ws_1", name: "People" },
    { id: "kb_c", workspaceId: "ws_1", name: "Not given" },
    { id: "kb_foreign", workspaceId: "ws_2", name: "Other workspace" },
  ]);
  state.rows.set("agent", [
    {
      id: "agent_kb",
      workspaceId: "ws_1",
      config: { knowledgeBaseIds: ["kb_a", "kb_b", "kb_foreign"], other: 1 },
    },
    { id: "agent_none", workspaceId: "ws_1", config: {} },
  ]);
  state.search.mockImplementation(async (_ws: string, kb: string) =>
    kb === "kb_a" ? [hit("a1", 0.9), hit("a2", 0.5)] : [hit("b1", 0.7)]
  );
});

describe("knowledge_search bound to an agent's knowledge bases", () => {
  it("searches every configured base without kbId and merges by score", async () => {
    const out = (await executeTool("knowledge_search", { query: "vpn" }, ctx)) as {
      results: { id: string }[];
    };
    expect(state.search.mock.calls.map((c) => c[1]).sort()).toEqual(["kb_a", "kb_b"]);
    expect(out.results.map((r) => r.id)).toEqual(["a1", "b1", "a2"]);
  });

  it("caps the merged results at topK", async () => {
    const out = (await executeTool("knowledge_search", { query: "vpn", topK: 2 }, ctx)) as {
      results: unknown[];
    };
    expect(out.results).toHaveLength(2);
  });

  it("searches only the requested base when it is configured", async () => {
    await executeTool("knowledge_search", { query: "vpn", kbId: "kb_b" }, ctx);
    expect(state.search.mock.calls.map((c) => c[1])).toEqual(["kb_b"]);
  });

  it("refuses a base the agent was not given", async () => {
    await expect(
      executeTool("knowledge_search", { query: "vpn", kbId: "kb_c" }, ctx)
    ).rejects.toThrow(/not one of this agent's knowledge bases/);
    expect(state.search).not.toHaveBeenCalled();
  });

  it("refuses a base from another workspace even if it is configured", async () => {
    await expect(
      executeTool("knowledge_search", { query: "vpn", kbId: "kb_foreign" }, ctx)
    ).rejects.toThrow(/not one of this agent's knowledge bases/);
    await executeTool("knowledge_search", { query: "vpn" }, ctx);
    expect(state.search.mock.calls.map((c) => c[1])).not.toContain("kb_foreign");
  });

  it("keeps requiring kbId for an agent without bases", async () => {
    const noKb = { ...ctx, agentId: "agent_none" };
    await expect(executeTool("knowledge_search", { query: "vpn" }, noKb)).rejects.toThrow(
      "kbId and query required"
    );
    await executeTool("knowledge_search", { query: "vpn", kbId: "kb_c" }, noKb);
    expect(state.search.mock.calls.map((c) => c[1])).toEqual(["kb_c"]);
  });

  it("keeps requiring kbId without an agent context", async () => {
    await expect(
      executeTool("knowledge_search", { query: "vpn" }, { workspaceId: "ws_1", variables: {} })
    ).rejects.toThrow("kbId and query required");
  });
});

describe("knowledge_search definition shown to the model", () => {
  it("makes kbId optional and lists the agent's bases by name", async () => {
    const [def] = await resolveToolDefinitions("ws_1", ["knowledge_search"], undefined, {
      id: "agent_kb",
      config: { knowledgeBaseIds: ["kb_a", "kb_b", "kb_foreign"] },
    });
    const schemaJson = def!.inputSchema as { required: string[] };
    expect(schemaJson.required).toEqual(["query"]);
    const text = JSON.stringify(def);
    expect(text).toContain("IT");
    expect(text).toContain("kb_b");
    expect(text).not.toContain("Other workspace");
    expect(text).not.toContain("kb_c");
  });

  it("is unchanged for an agent without bases", async () => {
    const [def] = await resolveToolDefinitions("ws_1", ["knowledge_search"], undefined, {
      id: "agent_none",
      config: {},
    });
    expect((def!.inputSchema as { required: string[] }).required).toEqual(["kbId", "query"]);
  });
});
