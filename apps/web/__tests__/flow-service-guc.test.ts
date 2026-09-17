import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const state = vi.hoisted(() => ({ statements: [] as SQL[] }));
vi.mock("@orchester/db", () => ({
  getDb: () => ({
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: async (statement: SQL) => {
          state.statements.push(statement);
        },
        select: () => tx,
        from: () => tx,
        where: () => tx,
        limit: async () => [{ id: "flow_test", workspaceId: "ws_test" }],
      };
      return fn(tx);
    },
  }),
  schema: { flows: { id: "id", workspaceId: "workspace_id" } },
}));
vi.mock("@/lib/tenant/resolve", () => ({ resolveById: vi.fn() }));
vi.mock("@/lib/tenant/membership", () => ({ checkMembership: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ getCurrentSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/billing/quotas", () => ({ checkQuota: vi.fn() }));

const { getFlow } = await import("@/lib/flows/service");
const { withWorkspaceTx } = await import("@/lib/tenant/context");
const statements = () => state.statements.map((s) => new PgDialect().sqlToQuery(s));
beforeEach(() => {
  state.statements = [];
});

it("sets the user's GUC immediately after the workspace GUC", async () => {
  await getFlow({ kind: "user", workspaceId: "ws_test", userId: "user_test" }, "flow_test");
  expect(statements()).toMatchObject([
    { sql: "SET LOCAL ROLE app_user", params: [] },
    { sql: "SELECT set_config('app.workspace_id', $1, true)", params: ["ws_test"] },
    { sql: "SELECT set_config('app.user_id', $1, true)", params: ["user_test"] },
  ]);
});

it("does not set a user GUC for an API-key actor", async () => {
  await getFlow({ kind: "apiKey", workspaceId: "ws_test", keyId: "key_test" }, "flow_test");
  expect(statements()).toHaveLength(2);
  expect(statements()[1]?.params).toEqual(["ws_test"]);
  expect(statements().some((s) => s.sql.includes("app.user_id"))).toBe(false);
});

it("keeps the existing withWorkspaceTx callback signature working", async () => {
  expect(await withWorkspaceTx("ws_test", async () => "result")).toBe("result");
  expect(statements()).toHaveLength(2);
});
