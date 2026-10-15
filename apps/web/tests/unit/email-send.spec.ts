// sendEmail reports whether it actually sent, and never writes an invite or
// reset URL to the production log when no provider is configured.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/lib/http-util", () => ({ fetchWithTimeout: (...a: unknown[]) => fetchMock(...a) }));

const { sendEmail } = await import("@/lib/email");

const params = {
  to: "someone@example.com",
  subject: "Invite",
  text: "Accept: https://app.example.com/invite/SECRET_TOKEN",
};

beforeEach(() => {
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendEmail", () => {
  it("returns sent when the provider accepts the request", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    fetchMock.mockResolvedValue({ ok: true });
    await expect(sendEmail(params)).resolves.toEqual({ status: "sent" });
  });

  it("throws when the provider rejects the request", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => "domain" });
    await expect(sendEmail(params)).rejects.toThrow("Resend 403");
  });

  it("returns not_configured without calling the provider when there is no key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(sendEmail(params)).resolves.toEqual({ status: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs no recipient, subject or URL in production when not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sendEmail(params);
    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain("SECRET_TOKEN");
    expect(logged).not.toContain("someone@example.com");
    expect(logged).not.toContain("Invite");
  });

  it("keeps the dev log with the link outside production", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendEmail(params);
    expect(JSON.stringify(log.mock.calls)).toContain("SECRET_TOKEN");
  });
});
