// apps/web/tests/integration/notifications/resolve.spec.ts
//
// SET-1 — resolveNotificationPref applies user > workspace > default and
// triggers only send email when the pref resolves ON. We stub sendEmail
// and assert it's called/skipped according to the stored prefs.
import { it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

const sent: Array<{ to: string; subject: string }> = [];
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string }) => {
    sent.push({ to: p.to, subject: p.subject });
  }),
}));

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let wsA: WsFixture;
let resolveNotificationPref: typeof import("@/lib/notifications/resolve").resolveNotificationPref;
let notifyEscalation: typeof import("@/lib/notifications/triggers").notifyEscalation;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ resolveNotificationPref } = await import("@/lib/notifications/resolve"));
  ({ notifyEscalation } = await import("@/lib/notifications/triggers"));
  ({ getDb, schema } = await import("@orchester/db"));
}, 60_000);

afterAll(() => teardownTestWorkspaces());

it("falls back to the default when no row exists (conv_escalated default ON)", async () => {
  const on = await resolveNotificationPref(wsA.id, wsA.ownerId, "conv_escalated");
  expect(on).toBe(true);
  const off = await resolveNotificationPref(wsA.id, wsA.ownerId, "weekly_report");
  expect(off).toBe(false);
});

it("user pref overrides the default", async () => {
  const db = getDb();
  await db.insert(schema.notificationPrefs).values({
    id: createId(),
    workspaceId: wsA.id,
    userId: wsA.ownerId,
    key: "conv_escalated",
    enabled: false,
  });
  expect(await resolveNotificationPref(wsA.id, wsA.ownerId, "conv_escalated")).toBe(false);
});

it("notifyEscalation sends only to members whose pref is ON", async () => {
  sent.length = 0;
  // ownerId now has conv_escalated=false (from previous test); expect no send.
  await notifyEscalation(wsA.id, { conversationId: "c1" });
  expect(sent.find((s) => s.to === wsA.ownerEmail)).toBeUndefined();
});
