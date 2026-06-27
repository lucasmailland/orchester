// apps/web/tests/unit/auth-secret.spec.ts
//
// SEC-6: BETTER_AUTH_SECRET must throw in production when unset (no dev fallback),
// accept AUTH_SECRET as an alias, and warn-and-fall-back only in dev/test.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("SEC-6 — resolveAuthSecret", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      BETTER_AUTH_SECRET: process.env["BETTER_AUTH_SECRET"],
      AUTH_SECRET: process.env["AUTH_SECRET"],
      NODE_ENV: (process.env as Record<string, string | undefined>)["NODE_ENV"],
    };
    delete process.env["BETTER_AUTH_SECRET"];
    delete process.env["AUTH_SECRET"];
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, savedEnv);
    vi.resetModules();
  });

  it("PRODUCTION: throws when neither var is set", async () => {
    (process.env as Record<string, string | undefined>)["NODE_ENV"] = "production";
    const { resolveAuthSecret } = await import("@/lib/auth-secret");
    expect(() => resolveAuthSecret()).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("accepts AUTH_SECRET as an alias", async () => {
    (process.env as Record<string, string | undefined>)["NODE_ENV"] = "production";
    process.env["AUTH_SECRET"] = "an-aliased-production-secret-32chars";
    const { resolveAuthSecret } = await import("@/lib/auth-secret");
    expect(resolveAuthSecret()).toBe("an-aliased-production-secret-32chars");
  });

  it("DEV: warns once and falls back when unset", async () => {
    (process.env as Record<string, string | undefined>)["NODE_ENV"] = "development";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolveAuthSecret } = await import("@/lib/auth-secret");
    const result = resolveAuthSecret();
    expect(result).toMatch(/dev/);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
