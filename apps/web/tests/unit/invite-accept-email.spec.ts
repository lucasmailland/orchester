// apps/web/tests/unit/invite-accept-email.spec.ts
//
// SEC-3: accepting an invite must enforce that the invite's recipient email
// matches the logged-in user's email. A mismatch is a 403, not a no-op.
import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionMock = vi.fn();
const adminTx: {
  select: () => { from: () => { where: () => { limit: () => unknown[] } } };
  update: () => { set: () => { where: () => Promise<void> } };
  insert: () => { values: (v?: unknown) => { onConflictDoNothing: () => Promise<void> } };
  _rows: unknown[];
} = {
  select: () => ({ from: () => ({ where: () => ({ limit: () => adminTx._rows }) }) }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
  _rows: [],
};
const membershipInsert = vi.fn();

vi.mock("@/lib/workspace", () => ({ getCurrentSession: sessionMock }));
vi.mock("@/lib/validation", () => ({
  parseBody: async (req: Request) => ({ ok: true, data: await req.json() }),
}));
vi.mock("@orchester/db", () => ({
  schema: {
    workspaceInvites: {
      token: "token",
      id: "id",
      status: "status",
      workspaceId: "workspace_id",
      email: "email",
      role: "role",
      expiresAt: "expires_at",
      acceptedAt: "accepted_at",
    },
    workspaceMembers: { id: "id" },
  },
}));
vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));
vi.mock("@paralleldrive/cuid2", () => ({ createId: () => "m_1" }));
vi.mock("@/lib/tenant/cron", () => ({
  withCrossTenantAdmin: async (_l: string, fn: (tx: typeof adminTx) => Promise<unknown>) => {
    adminTx.insert = () => ({
      values: (v: unknown) => {
        membershipInsert(v);
        return { onConflictDoNothing: () => Promise.resolve() };
      },
    });
    return fn(adminTx);
  },
}));

let POST: typeof import("@/app/api/invites/accept/route").POST;
beforeEach(async () => {
  sessionMock.mockReset();
  membershipInsert.mockReset();
  adminTx._rows = [];
  vi.resetModules();
  ({ POST } = await import("@/app/api/invites/accept/route"));
});

function makeReq() {
  return new Request("http://localhost/api/invites/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "tok_1" }),
  });
}

describe("SEC-3 — invite accept enforces recipient email", () => {
  it("rejects when the invite email does not match the session email (403, no membership)", async () => {
    sessionMock.mockResolvedValue({ user: { id: "u_1", email: "intruder@evil.com" } });
    adminTx._rows = [
      {
        id: "i_1",
        token: "tok_1",
        status: "pending",
        workspaceId: "ws_1",
        role: "admin",
        email: "owner@acme.com",
        expiresAt: new Date(Date.now() + 1e7),
      },
    ];
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    expect(membershipInsert).not.toHaveBeenCalled();
  });

  it("accepts when the emails match (case-insensitive)", async () => {
    sessionMock.mockResolvedValue({ user: { id: "u_1", email: "Owner@Acme.com" } });
    adminTx._rows = [
      {
        id: "i_1",
        token: "tok_1",
        status: "pending",
        workspaceId: "ws_1",
        role: "editor",
        email: "owner@acme.com",
        expiresAt: new Date(Date.now() + 1e7),
      },
    ];
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(membershipInsert).toHaveBeenCalledTimes(1);
  });
});
