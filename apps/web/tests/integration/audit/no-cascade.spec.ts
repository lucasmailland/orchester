// apps/web/tests/integration/audit/no-cascade.spec.ts
//
// SEC-009: audit_log has no FKs to workspace or user (migration 0072).
// Deleting either keeps the audit rows; retention removes them by age alone,
// whether or not the workspace still exists.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

process.env.ENCRYPTION_SECRET ??= "0123456789abcdef".repeat(4);

import { createId } from "@paralleldrive/cuid2";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  insertAdHocWorkspace,
} from "../../fixtures/workspaces";

let appendAuditSync: typeof import("@/lib/audit/log").appendAuditSync;
let purgeOldData: typeof import("@/lib/retention").purgeOldData;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;

beforeAll(async () => {
  await setupTestWorkspaces();
  ({ appendAuditSync } = await import("@/lib/audit/log"));
  ({ purgeOldData } = await import("@/lib/retention"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq } = await import("drizzle-orm"));
});
afterAll(() => teardownTestWorkspaces());

async function newWs(): Promise<{ wsId: string; ownerId: string }> {
  const wsId = createId();
  const ownerId = createId();
  await insertAdHocWorkspace(getDb(), { wsId, ownerId, slug: `nc-${wsId.slice(0, 10)}` });
  return { wsId, ownerId };
}

function entry(wsId: string, actorUserId: string) {
  return {
    action: "workspace.update",
    actorUserId,
    actorKind: "user" as const,
    targetType: "workspace",
    targetId: wsId,
    meta: {},
  };
}

async function auditRows(wsId: string) {
  return getDb().select().from(schema.auditLog).where(eq(schema.auditLog.workspaceId, wsId));
}

describe("audit_log without cascading deletes", () => {
  it("keeps the audit rows when the workspace is deleted", async () => {
    const { wsId, ownerId } = await newWs();
    await appendAuditSync(wsId, entry(wsId, ownerId));
    await appendAuditSync(wsId, entry(wsId, ownerId));
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, wsId));
    expect(await auditRows(wsId)).toHaveLength(2);
  });

  it("deletes a user with audit rows in a live workspace, and keeps the rows", async () => {
    const { wsId, ownerId } = await newWs();
    const userId = createId();
    await getDb()
      .insert(schema.users)
      .values({ id: userId, email: `${userId}@test.local`, name: "leaver", emailVerified: true });
    await appendAuditSync(wsId, entry(wsId, userId));
    await appendAuditSync(wsId, entry(wsId, ownerId));

    await getDb().delete(schema.users).where(eq(schema.users.id, userId));

    const rows = await auditRows(wsId);
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.actorUserId === userId)).toBe(true);
  });

  it("retention purges an orphan row (workspace gone) older than the window", async () => {
    const { wsId, ownerId } = await newWs();
    await appendAuditSync(wsId, entry(wsId, ownerId));
    await getDb()
      .update(schema.auditLog)
      .set({ createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.auditLog.workspaceId, wsId));
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, wsId));
    expect(await auditRows(wsId)).toHaveLength(1);

    await purgeOldData({ auditLogsDays: 365, db: getDb() });

    expect(await auditRows(wsId)).toHaveLength(0);
  });
});
