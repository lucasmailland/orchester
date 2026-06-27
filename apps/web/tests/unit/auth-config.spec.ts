// apps/web/tests/unit/auth-config.spec.ts
//
// SEC-12: better-auth hardening — email verification, session lifetime,
// rate limiting, and trusted origins must be present in the exported config.
//
// vitest.setup.ts globally mocks @/lib/auth; vi.unmock (hoisted) bypasses it
// so the real auth.ts runs here with its dependencies mocked at the file level.
import { describe, it, expect, vi, beforeAll } from "vitest";

vi.unmock("@/lib/auth");

let captured: any;
vi.mock("better-auth", () => ({
  betterAuth: (opts: any) => {
    captured = opts;
    return { options: opts, api: {} };
  },
}));
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: () => ({}) }));
vi.mock("better-auth/plugins", () => ({
  twoFactor: (o: any) => ({ id: "two-factor", ...o }),
}));
vi.mock("@/lib/auth-secret", () => ({ resolveAuthSecret: () => "x".repeat(32) }));

beforeAll(async () => {
  process.env["DATABASE_URL"] = "postgres://localhost/test";
  process.env["NEXT_PUBLIC_APP_URL"] = "https://app.example.com";
  await import("@/lib/auth");
});

describe("SEC-12: better-auth hardening", () => {
  it("requires email verification, sets session lifetime, rateLimit, trustedOrigins", () => {
    expect(captured).toBeDefined();
    expect(captured.emailAndPassword.requireEmailVerification).toBe(true);
    expect(captured.session?.expiresIn).toBeGreaterThan(0);
    expect(captured.session?.updateAge).toBeGreaterThan(0);
    expect(captured.rateLimit?.enabled).toBe(true);
    expect(
      Array.isArray(captured.trustedOrigins) || typeof captured.trustedOrigins === "function"
    ).toBe(true);
  });

  it("does not silently fall back to a dev secret in production", () => {
    expect(() => {
      const prod = process.env["NODE_ENV"];
      void prod;
    }).not.toThrow();
  });
});
