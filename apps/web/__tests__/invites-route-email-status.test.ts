import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  logAudit: vi.fn(),
  safeLogError: vi.fn(),
}));

vi.mock("@/lib/auth-guards", () => ({
  requireAuth: async () => ({
    workspace: { id: "ws_test", name: `Acme <b>"&" Inc` },
    user: { id: "user_test", email: "owner@example.com" },
  }),
  isAuthContext: () => true,
}));
vi.mock("@/lib/billing/quotas", () => ({ checkQuota: async () => ({ allowed: true }) }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.logAudit }));
vi.mock("@/lib/safe-log", () => ({ safeLogError: mocks.safeLogError }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@orchester/db", () => {
  const tx = {
    execute: async () => undefined,
    insert: () => ({
      values: (v: Record<string, unknown>) => ({ returning: async () => [{ id: "inv_1", ...v }] }),
    }),
  };
  return {
    schema: { workspaceInvites: {} },
    getDb: () => ({ transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) }),
  };
});

const { POST } = await import("@/app/api/invites/route");
const call = () =>
  POST(
    new Request("https://example.com/api/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "New@Example.com", role: "editor" }),
    })
  );

beforeEach(() => vi.clearAllMocks());

describe("POST /api/invites emailStatus", () => {
  it("reports sent and escapes the workspace name in the HTML", async () => {
    mocks.sendEmail.mockResolvedValue({ status: "sent" });
    const res = await call();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.emailStatus).toBe("sent");
    expect(body.inviteUrl).toContain("/invite/");
    expect(mocks.logAudit.mock.calls[0]![0].after).toMatchObject({ emailStatus: "sent" });
    const { html } = mocks.sendEmail.mock.calls[0]![0];
    expect(html).toContain("Acme &lt;b&gt;&quot;&amp;&quot; Inc");
    expect(html).not.toContain('<b>"');
  });

  it("reports not_configured but still creates the invite", async () => {
    mocks.sendEmail.mockResolvedValue({ status: "not_configured" });
    const res = await call();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.emailStatus).toBe("not_configured");
    expect(body.inviteUrl).toBeTruthy();
    expect(mocks.logAudit.mock.calls[0]![0].after).toMatchObject({
      emailStatus: "not_configured",
    });
  });

  it("reports failed, logs the error and still returns the link", async () => {
    mocks.sendEmail.mockRejectedValue(new Error("Resend 403"));
    const res = await call();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.emailStatus).toBe("failed");
    expect(body.inviteUrl).toBeTruthy();
    expect(mocks.safeLogError).toHaveBeenCalledTimes(1);
    expect(mocks.logAudit.mock.calls[0]![0].after).toMatchObject({ emailStatus: "failed" });
  });
});
