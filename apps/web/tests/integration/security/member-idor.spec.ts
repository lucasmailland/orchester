// apps/web/tests/integration/security/member-idor.spec.ts
//
// SEC-11: member-management IDOR guards + hashed invite tokens.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import { setupIsolation, teardownIsolation, type IsolationFixture } from "../../isolation/helpers";
import { teardownTestWorkspaces } from "../../fixtures/workspaces";

vi.mock("@/lib/workspace", async (orig) => {
  const actual = await orig<typeof import("@/lib/workspace")>();
  return { ...actual, getCurrentSession: vi.fn(), getCurrentWorkspace: vi.fn() };
});

let f: IsolationFixture;
beforeAll(async () => {
  f = await setupIsolation();
}, 90_000);
afterAll(async () => {
  await teardownIsolation(f);
  await teardownTestWorkspaces();
});

describe("SEC-11: member management self-IDOR guard", () => {
  it("PATCH cannot change the caller's own role", async () => {
    const ws = await import("@/lib/workspace");
    (ws.getCurrentSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: f.wsA.ownerId, email: f.wsA.ownerEmail, name: "o" },
    });
    (ws.getCurrentWorkspace as ReturnType<typeof vi.fn>).mockResolvedValue({
      workspace: { id: f.wsA.id, slug: f.wsA.slug, name: "A" },
      role: "admin",
    });

    const { PATCH } = await import("@/app/api/workspace-members/route");
    const res = await PATCH(
      new Request(`http://x?userId=${f.wsA.ownerId}&role=viewer`, { method: "PATCH" })
    );
    expect([400, 403]).toContain(res.status);
  });

  it("DELETE cannot remove the caller themselves", async () => {
    const ws = await import("@/lib/workspace");
    (ws.getCurrentSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: f.wsA.ownerId, email: f.wsA.ownerEmail, name: "o" },
    });
    (ws.getCurrentWorkspace as ReturnType<typeof vi.fn>).mockResolvedValue({
      workspace: { id: f.wsA.id, slug: f.wsA.slug, name: "A" },
      role: "admin",
    });

    const { DELETE } = await import("@/app/api/workspace-members/route");
    const res = await DELETE(new Request(`http://x?userId=${f.wsA.ownerId}`, { method: "DELETE" }));
    expect([400, 403]).toContain(res.status);
  });
});
