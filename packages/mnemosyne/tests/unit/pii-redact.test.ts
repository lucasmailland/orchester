import { describe, it, expect } from "vitest";
import { redactPII } from "../../src/pii/redact";

describe("pii/redact", () => {
  it("replaces email with [REDACTED-email]", () => {
    const r = redactPII("Contact lucas@example.com please");
    expect(r).toBe("Contact [REDACTED-email] please");
  });

  it("replaces multiple categories", () => {
    const r = redactPII("Email lucas@x.com card 4111 1111 1111 1111 SSN 123-45-6789");
    expect(r).toContain("[REDACTED-email]");
    expect(r).toContain("[REDACTED-credit_card]");
    expect(r).toContain("[REDACTED-ssn]");
  });

  it("leaves clean text untouched", () => {
    expect(redactPII("hello world")).toBe("hello world");
  });
});
