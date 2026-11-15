// apps/web/tests/integration/security/rbac-read-gates.spec.ts
//
// SEC-15: viewers must not be able to list pending invites (emails of people
// who are not members yet). The member list stays readable by every member:
// the settings Members tab is shown to all of them.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/workspace", async (orig) => {
  const actual = await orig<typeof import("@/lib/workspace")>();
  return {
    ...actual,
    getCurrentSession: vi.fn().mockResolvedValue({ user: { id: "u1", email: "v@x", name: "v" } }),
    getCurrentWorkspace: vi.fn().mockResolvedValue({
      workspace: { id: "ws1", slug: "ws-1", name: "W" },
      role: "viewer",
    }),
  };
});

describe("SEC-15: viewer cannot read pending invites", () => {
  it("GET /api/invites → 403 for viewer", async () => {
    const { GET } = await import("@/app/api/invites/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });
});
