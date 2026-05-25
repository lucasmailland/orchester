import { describe, it, expect } from "vitest";
import { detectPII } from "../../src/pii/detect";

describe("pii/detect", () => {
  it("detects email", () => {
    const r = detectPII("Contact me at lucas@example.com please");
    expect(r.detected).toBe(true);
    expect(r.categories).toContain("email");
    expect(r.risk_score).toBeGreaterThan(0);
  });

  it("detects phone (US format)", () => {
    const r = detectPII("Call me at +1 555 123 4567");
    expect(r.categories).toContain("phone");
  });

  it("detects credit card (Visa-like)", () => {
    const r = detectPII("My card is 4111 1111 1111 1111");
    expect(r.categories).toContain("credit_card");
  });

  it("detects SSN", () => {
    const r = detectPII("SSN: 123-45-6789");
    expect(r.categories).toContain("ssn");
  });

  it("detects API key (OpenAI-style)", () => {
    const r = detectPII("Token sk-abcdef0123456789abcdef0123456789");
    expect(r.categories).toContain("api_key");
  });

  it("returns detected=false for clean text", () => {
    const r = detectPII("The user prefers responses in Spanish for billing topics");
    expect(r.detected).toBe(false);
    expect(r.categories).toEqual([]);
  });
});
