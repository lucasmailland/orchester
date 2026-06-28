// apps/web/tests/integration/audit/budget-audit.spec.ts
//
// COST-8 — employee budget changes must land in the hash-chained audit_log.
import { it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let logAudit: typeof import("@/lib/audit").logAudit;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;
let and: typeof import("drizzle-orm").and;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ logAudit } = await import("@/lib/audit"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq, and } = await import("drizzle-orm"));
}, 60_000);

afterAll(() => teardownTestWorkspaces());

it("writes an audit_log row for a budget change", async () => {
  await logAudit({
    workspaceId: wsA.id,
    userId: wsA.ownerId,
    action: "employee.budget_update",
    resource: "employee",
    resourceId: "emp-123",
    after: { monthlyBudgetUsd: "50" },
  });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.workspaceId, wsA.id),
        eq(schema.auditLog.action, "employee.budget_update")
      )
    );
  expect(rows.length).toBeGreaterThanOrEqual(1);
  expect(rows[0]!.targetId).toBe("emp-123");
});
