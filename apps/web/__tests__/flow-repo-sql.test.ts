import { beforeEach, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { FlowRepo } from "@/lib/flows/flow-repo";

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  tx: undefined as unknown,
}));
vi.mock("@orchester/db", async () => ({
  schema: await import("../../../packages/db/src/schema"),
}));
vi.mock("@/lib/tenant/context", () => ({
  withWorkspaceTx: async (_ws: string, fn: (tx: unknown) => Promise<unknown>) => fn(state.tx),
}));
vi.mock("@/lib/audit/log", () => ({
  appendAuditInTx: vi.fn(async () => ({ rotatedAtSeq: null })),
  warnChainRotated: vi.fn(),
}));

const { withRepo } = await import("@/lib/flows/flow-repo");
const actor = { kind: "apiKey", workspaceId: "ws_test", keyId: "key_test" } as const;

beforeEach(() => {
  state.queries = [];
  state.tx = drizzle(async (sql, params) => {
    state.queries.push({ sql, params });
    return { rows: [] };
  });
});

const scopedQueries: Array<[string, (r: FlowRepo) => Promise<unknown>]> = [
  ["findFlow", (r) => r.findFlow("flow_test", actor.workspaceId)],
  ["listFlows", (r) => r.listFlows(actor.workspaceId)],
  ["updateFlow", (r) => r.updateFlow("flow_test", actor.workspaceId, { name: "test" })],
  ["findRun", (r) => r.findRun("run_test", actor.workspaceId)],
  ["listRuns", (r) => r.listRuns("flow_test", actor.workspaceId, 20)],
  ["listWebhooks", (r) => r.listWebhooks("flow_test", actor.workspaceId)],
  ["findTemplate", (r) => r.findTemplate("template_test", actor.workspaceId)],
];

it.each(scopedQueries)("%s compiles an explicit workspace predicate", async (method, query) => {
  await withRepo(actor, query);
  expect(state.queries).toHaveLength(1);
  const { sql, params } = state.queries[0]!;
  const match = sql.match(/"workspace_id" = \$(\d+)/);
  expect(match, method).not.toBeNull();
  expect(params[Number(match![1]) - 1]).toBe(actor.workspaceId);
  if (method === "findTemplate") {
    // Public templates are intentionally available across workspaces.
    expect(sql).toMatch(/"is_public" = \$\d+ or .*"workspace_id" = \$\d+/);
  }
});

it.each(["insertFlow", "insertWebhook"] as const)(
  "%s binds workspace_id in its INSERT values (INSERT has no WHERE predicate)",
  async (method) => {
    await withRepo(actor, async (r) => {
      if (method === "insertFlow") {
        return r.insertFlow({ id: "flow_test", workspaceId: actor.workspaceId, name: "test" });
      }
      return r.insertWebhook({
        id: "webhook_test",
        flowId: "flow_test",
        workspaceId: actor.workspaceId,
        secret: "test-secret",
      });
    });
    expect(state.queries).toHaveLength(1);
    const { sql, params } = state.queries[0]!;
    const match = sql.match(/insert into "[^"]+" \(([^)]+)\) values \(([^)]+)\)/);
    expect(match).not.toBeNull();
    const columns = match![1]!.split(",").map((s) => s.trim());
    const values = match![2]!.split(",").map((s) => s.trim());
    const placeholder = values[columns.indexOf('"workspace_id"')];
    expect(placeholder).toMatch(/^\$\d+$/);
    expect(params[Number(placeholder!.slice(1)) - 1]).toBe(actor.workspaceId);
  }
);

it("listSteps deliberately filters only by run_id after the service guards with findRun", async () => {
  await withRepo(actor, async (r) => {
    await r.findRun("run_test", actor.workspaceId);
    return r.listSteps("run_test");
  });
  expect(state.queries).toHaveLength(2);
  const guarded = state.queries[0]!;
  expect(guarded.sql).toMatch(/"workspace_id" = \$\d+/);
  const steps = state.queries[1]!;
  expect(steps.sql).toMatch(/where "flow_run_step"."run_id" = \$1/);
  expect(steps.sql).not.toContain('"workspace_id"');
  expect(steps.params).toEqual(["run_test"]);
});

it("audit delegates the transaction and workspace to the audit repository", async () => {
  const { appendAuditInTx } = await import("@/lib/audit/log");
  const entry = {
    action: "flow.create",
    actorKind: "api_key" as const,
    actorUserId: null,
    targetType: "flow",
    targetId: "flow_test",
    meta: {},
  };
  await withRepo(actor, (r) => r.audit(actor.workspaceId, entry));
  expect(appendAuditInTx).toHaveBeenCalledWith(state.tx, actor.workspaceId, entry);
});
