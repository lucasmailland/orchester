import { describe, it, expect } from "vitest";
import { redactSecrets } from "@/lib/safe-log";

describe("safe-log redaction", () => {
  it.each([
    ["mns_live_" + "a".repeat(24), "mns_live_***REDACTED***"],
    ["sk_live_" + "b".repeat(24), "sk_live_***REDACTED***"],
    ["whsec_" + "c".repeat(24), "whsec_***REDACTED***"],
    ["ghp_" + "d".repeat(36), "gh*_***REDACTED***"],
    ["glpat-" + "e".repeat(20), "glpat-***REDACTED***"],
  ])("redacts %s", (secret, expected) => {
    expect(redactSecrets(`token=${secret} end`)).toBe(`token=${expected} end`);
  });
});
