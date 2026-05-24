// apps/web/tests/unit/cookies.spec.ts
//
// Unit tests for the HMAC-signed cookie helpers in lib/cookies.ts.
// No DB / no network — pure crypto. Covers:
//   - sign/verify roundtrip on the happy path
//   - tamper detection (mutated value, mutated tag)
//   - format rejection (missing tag, missing value, empty string,
//     no separator)
//   - length-mismatch shortcut (different secret → different tag
//     length, must return null without throwing)
//   - dev fallback warning fires exactly once (one-shot console.warn)
//   - PRODUCTION refuses to fall back: throws when secret unset
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("lib/cookies", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Use a stable known secret per test, with a clean module cache so
    // the importKey cache + warnedDevSecret flag reset between tests.
    process.env["COOKIE_SIGNING_SECRET"] = "test-secret-for-cookie-unit-tests-32b";
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("sign/verify roundtrip returns the original value", async () => {
    const { signValue, verifySigned } = await import("@/lib/cookies");
    const signed = await signValue("acme-hr");
    expect(signed).toMatch(/^acme-hr\.[A-Za-z0-9_-]+$/);
    const recovered = await verifySigned(signed);
    expect(recovered).toBe("acme-hr");
  });

  it("verify returns null for a tampered VALUE", async () => {
    const { signValue, verifySigned } = await import("@/lib/cookies");
    const signed = await signValue("acme-hr");
    const dot = signed.lastIndexOf(".");
    const tampered = "evil-tenant" + signed.slice(dot);
    expect(await verifySigned(tampered)).toBeNull();
  });

  it("verify returns null for a tampered TAG", async () => {
    const { signValue, verifySigned } = await import("@/lib/cookies");
    const signed = await signValue("acme-hr");
    // Flip the last character of the tag (which is base64url ⇒ always
    // a valid char; we just substitute one).
    const flipped = signed.slice(0, -1) + (signed.endsWith("A") ? "B" : "A");
    expect(await verifySigned(flipped)).toBeNull();
  });

  it("verify returns null on missing separator", async () => {
    const { verifySigned } = await import("@/lib/cookies");
    expect(await verifySigned("no-dot-here")).toBeNull();
  });

  it("verify returns null on empty string", async () => {
    const { verifySigned } = await import("@/lib/cookies");
    expect(await verifySigned("")).toBeNull();
  });

  it("verify returns null when value is empty (leading dot)", async () => {
    const { verifySigned } = await import("@/lib/cookies");
    expect(await verifySigned(".sometag")).toBeNull();
  });

  it("verify returns null when tag is empty (trailing dot)", async () => {
    const { verifySigned } = await import("@/lib/cookies");
    expect(await verifySigned("slug.")).toBeNull();
  });

  it("verify returns null when the tag length differs (different secret)", async () => {
    // Sign with one secret, verify with another. The tag length is
    // identical (HMAC-SHA256 always 32 bytes ⇒ 43 chars base64url) so
    // length-shortcut won't fire — but the tag itself differs, so the
    // constant-time compare returns false.
    const { signValue } = await import("@/lib/cookies");
    const signed = await signValue("acme-hr");
    process.env["COOKIE_SIGNING_SECRET"] = "a-completely-different-secret-value-xx";
    vi.resetModules();
    const { verifySigned } = await import("@/lib/cookies");
    expect(await verifySigned(signed)).toBeNull();
  });

  it("verify rejects values with a non-base64url tag of wrong length", async () => {
    // Construct a cookie whose tag is too short for an HMAC-SHA256
    // base64url string (43 chars) — exercises the length-shortcut.
    const { verifySigned } = await import("@/lib/cookies");
    expect(await verifySigned("slug.short")).toBeNull();
  });

  it("verify uses lastIndexOf for the separator (value may contain dots)", async () => {
    // While slugs in practice never contain dots, the helper should
    // not be confused by them — only the LAST dot delimits the tag.
    const { signValue, verifySigned } = await import("@/lib/cookies");
    const signed = await signValue("foo.bar.baz");
    expect(await verifySigned(signed)).toBe("foo.bar.baz");
  });

  it("PRODUCTION: throws when COOKIE_SIGNING_SECRET is unset", async () => {
    delete process.env["COOKIE_SIGNING_SECRET"];
    process.env["NODE_ENV"] = "production";
    vi.resetModules();
    const { signValue } = await import("@/lib/cookies");
    await expect(signValue("any")).rejects.toThrow(/COOKIE_SIGNING_SECRET required/);
  });

  it("DEV: falls back to the dev secret with a one-shot warning", async () => {
    delete process.env["COOKIE_SIGNING_SECRET"];
    process.env["NODE_ENV"] = "development";
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { signValue, verifySigned } = await import("@/lib/cookies");
    const signed = await signValue("acme-hr");
    expect(await verifySigned(signed)).toBe("acme-hr");
    // Sign + verify both call getSecret(); warning fires once total.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/dev fallback/);
    warn.mockRestore();
  });
});
