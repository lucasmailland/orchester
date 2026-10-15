import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendEmail: vi.fn(), safeLogError: vi.fn() }));

vi.mock("@/lib/auth-guards", () => ({
  requireAuth: async () => ({
    workspace: { id: "ws_test" },
    user: { id: "user_test", email: "owner@example.com" },
  }),
  isAuthContext: () => true,
}));
vi.mock("@/lib/safe-log", () => ({ safeLogError: mocks.safeLogError }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));

const { POST } = await import("@/app/api/admin/test-email/route");
const call = (to = "dest@example.com") =>
  POST(
    new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to }),
    })
  );

beforeEach(() => vi.clearAllMocks());

describe("POST /api/admin/test-email", () => {
  it("answers 503 and ok:false when email is not configured", async () => {
    mocks.sendEmail.mockResolvedValue({ status: "not_configured" });
    const res = await call();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, status: "not_configured" });
    expect(body.hint).toContain("RESEND_API_KEY");
    expect(body.hint).toContain("EMAIL_FROM");
    expect(body.hint).not.toMatch(/SMTP|MAIL_DRIVER/);
  });

  it("answers ok when the email was sent", async () => {
    mocks.sendEmail.mockResolvedValue({ status: "sent" });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, to: "dest@example.com" });
  });

  it("answers 500 with the hint when the provider fails", async () => {
    mocks.sendEmail.mockRejectedValue(new Error("Resend 403"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false });
  });
});
