// apps/web/tests/integration/security/rbac-read-gates.spec.ts
//
// SEC-15: viewers must not be able to list member PII or pending invites.
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

describe("SEC-15: viewer cannot read members or invites", () => {
  it("GET /api/workspace-members → 403 for viewer", async () => {
    const { GET } = await import("@/app/api/workspace-members/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("GET /api/invites → 403 for viewer", async () => {
    const { GET } = await import("@/app/api/invites/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });
});
