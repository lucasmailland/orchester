// apps/web/tests/unit/lifecycle/token-compare.spec.ts
//
// B2.3 — constant-time restore-token comparison.
//
// `tokensMatch` is the lifecycle helper used by `restore()` to validate
// the one-shot restore token. It MUST:
//   1. Return false for length mismatches WITHOUT throwing (raw
//      `crypto.timingSafeEqual` throws on differing lengths — that
//      itself would be a side channel via the catch path).
//   2. Return false when the contents differ at the same length.
//   3. Return true only for byte-exact equal inputs.
//
// We don't try to measure actual timing here — that's brittle in CI —
// but we pin the contract that callers see (no throws, correct boolean).
import { describe, it, expect } from "vitest";
import { tokensMatch } from "@/lib/tenant/lifecycle";

describe("tokensMatch", () => {
  it("returns false for length mismatch without throwing", () => {
    expect(() => tokensMatch("rst_short", "rst_longer_token_value_here")).not.toThrow();
    expect(tokensMatch("rst_short", "rst_longer_token_value_here")).toBe(false);
  });

  it("returns false when contents differ at equal length", () => {
    const a = "rst_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const b = "rst_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    expect(a.length).toBe(b.length);
    expect(tokensMatch(a, b)).toBe(false);
  });

  it("returns true for byte-exact equal inputs", () => {
    const t = "rst_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    expect(tokensMatch(t, t)).toBe(true);
    expect(tokensMatch(t, String(t))).toBe(true);
  });

  it("returns true for two equal empty strings (degenerate but safe)", () => {
    expect(tokensMatch("", "")).toBe(true);
  });

  it("returns false for empty-vs-nonempty without throwing", () => {
    expect(() => tokensMatch("", "rst_x")).not.toThrow();
    expect(tokensMatch("", "rst_x")).toBe(false);
    expect(tokensMatch("rst_x", "")).toBe(false);
  });

  it("distinguishes inputs that differ only in a single byte", () => {
    const base = "rst_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const flipped = base.slice(0, -1) + "B";
    expect(base.length).toBe(flipped.length);
    expect(tokensMatch(base, flipped)).toBe(false);
  });
});
