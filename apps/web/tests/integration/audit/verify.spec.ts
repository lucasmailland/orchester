// apps/web/tests/integration/audit/verify.spec.ts
//
// Spec: docs/specs/2026-05-23-tenant-hardening-design.md §3.4
// Plan: Task A.19
//
// End-to-end check that verifyChain accepts an intact chain and flags
// retroactive mutations of `meta`. Uses the testcontainer fixtures so
// we get a real postgres + the production hash code under test.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Un-mock @orchester/db (default vitest.setup stubs it out for unit
// tests). Dynamic-import the modules below so the real client is loaded
// AFTER fixtures set DATABASE_URL.
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let appendAuditSync: typeof import("@/lib/audit/log").appendAuditSync;
let verifyChain: typeof import("@/lib/audit/verify").verifyChain;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ appendAuditSync } = await import("@/lib/audit/log"));
  ({ verifyChain } = await import("@/lib/audit/verify"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq } = await import("drizzle-orm"));

  for (let i = 0; i < 5; i++) {
    await appendAuditSync(wsA.id, {
      action: "workspace.update",
      actorUserId: wsA.ownerId,
      actorKind: "user",
      targetType: "workspace",
      targetId: wsA.id,
      meta: { i },
    });
  }
});
afterAll(() => teardownTestWorkspaces());

describe("verifyChain", () => {
  it("returns brokenAt=null for an intact chain", async () => {
    const r = await verifyChain(wsA.id);
    expect(r.brokenAt).toBeNull();
    expect(r.entriesChecked).toBe(5);
  });

  it("detects tampering when meta is modified", async () => {
    const db = getDb();
    await db
      .update(schema.auditLog)
      .set({ meta: { tampered: true } })
      .where(eq(schema.auditLog.workspaceId, wsA.id));
    const r = await verifyChain(wsA.id);
    expect(r.brokenAt).not.toBeNull();
  });
});
