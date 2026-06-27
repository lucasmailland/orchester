// apps/web/tests/integration/security/lifecycle-gate.spec.ts
//
// SEC-13: withTenantContext must block access to suspended/deleted workspaces.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import { setupIsolation, teardownIsolation, type IsolationFixture } from "../../isolation/helpers";
import { teardownTestWorkspaces } from "../../fixtures/workspaces";

vi.mock("@/lib/workspace", async (orig) => {
  const actual = await orig<typeof import("@/lib/workspace")>();
  return { ...actual, getCurrentSession: vi.fn() };
});

let f: IsolationFixture;
beforeAll(async () => {
  f = await setupIsolation();
}, 90_000);
afterAll(async () => {
  await teardownIsolation(f);
  await teardownTestWorkspaces();
});

describe("SEC-13: withTenantContext blocks suspended workspaces", () => {
  it("throws workspace_suspended for a suspended workspace", async () => {
    const ws = await import("@/lib/workspace");
    (ws.getCurrentSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: f.wsA.ownerId, email: f.wsA.ownerEmail, name: "o" },
    });

    // Suspend wsA directly then bust the resolver cache so the
    // next resolveById() re-reads from DB instead of the LRU.
    await f.sql.unsafe(
      `UPDATE workspace SET status='suspended', suspended_at=now(), suspended_reason='test' WHERE id=$1`,
      [f.wsA.id]
    );
    const { invalidateCache } = await import("@/lib/tenant/resolve");
    invalidateCache(f.wsA.id);

    const { withTenantContext } = await import("@/lib/tenant/context");
    await expect(withTenantContext(f.wsA.id, async () => "ok")).rejects.toMatchObject({
      code: "workspace_suspended",
    });
  });
});
