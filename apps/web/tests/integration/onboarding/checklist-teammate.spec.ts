// apps/web/tests/integration/onboarding/checklist-teammate.spec.ts
//
// `hasTeammate` of the first-run checklist against a real Postgres: a second
// member OR a live invitation counts. Expired, accepted and revoked invites do
// not, and neither does another workspace's invite (workspace_invite is FORCE
// RLS, read through the same workspace tx the dashboard page uses).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import { createId } from "@paralleldrive/cuid2";
import { setupTestDb } from "../../fixtures/db";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

type Sql = Awaited<ReturnType<typeof setupTestDb>>["sql"];

let sql: Sql;
let wsA: WsFixture;
let wsB: WsFixture;
let queries: typeof import("@/lib/db-queries");
let withWorkspaceTx: typeof import("@/lib/tenant/context").withWorkspaceTx;

const DAY = 24 * 60 * 60 * 1000;

async function invite(
  ws: WsFixture,
  over: { expiresAt?: Date; status?: string; acceptedAt?: Date | null } = {}
) {
  const id = createId();
  await sql`INSERT INTO workspace_invite
      (id, workspace_id, email, role, status, token, invited_by_user_id, expires_at, accepted_at)
    VALUES (${id}, ${ws.id}, ${`${id}@example.com`}, 'editor',
      ${over.status ?? "pending"}::workspace_invite_status, ${createId()}, ${ws.ownerId},
      ${(over.expiresAt ?? new Date(Date.now() + 7 * DAY)).toISOString()}::timestamp,
      ${over.acceptedAt ? over.acceptedAt.toISOString() : null}::timestamp)`;
  return id;
}

async function clearInvites() {
  await sql`DELETE FROM workspace_invite`;
}

const hasTeammate = (ws: WsFixture) =>
  withWorkspaceTx(ws.id, (tx) => queries.getOnboardingChecklistState(ws.id, tx)).then(
    (s) => s.hasTeammate
  );

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
  ({ sql } = await setupTestDb());
  queries = await import("@/lib/db-queries");
  ({ withWorkspaceTx } = await import("@/lib/tenant/context"));
});
afterAll(() => teardownTestWorkspaces());

describe("getOnboardingChecklistState.hasTeammate", () => {
  it("is false with only the owner and no invites", async () => {
    await clearInvites();
    expect(await hasTeammate(wsA)).toBe(false);
  });

  it("is true with a pending, unexpired invite", async () => {
    await clearInvites();
    await invite(wsA);
    expect(await hasTeammate(wsA)).toBe(true);
  });

  it("ignores an expired invite", async () => {
    await clearInvites();
    await invite(wsA, { expiresAt: new Date(Date.now() - DAY) });
    expect(await hasTeammate(wsA)).toBe(false);
  });

  it("ignores an accepted invite", async () => {
    await clearInvites();
    await invite(wsA, { status: "accepted", acceptedAt: new Date() });
    expect(await hasTeammate(wsA)).toBe(false);
  });

  it("ignores a revoked invite", async () => {
    await clearInvites();
    await invite(wsA, { status: "revoked" });
    expect(await hasTeammate(wsA)).toBe(false);
  });

  it("ignores another workspace's pending invite", async () => {
    await clearInvites();
    await invite(wsB);
    expect(await hasTeammate(wsA)).toBe(false);
    expect(await hasTeammate(wsB)).toBe(true);
  });
});
