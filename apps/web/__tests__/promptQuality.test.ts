import { describe, it, expect } from "vitest";
import { promptQuality } from "../components/agents/studio/promptQuality";

describe("promptQuality", () => {
  it("scores empty prompt low", () => {
    expect(promptQuality("").score).toBeLessThan(20);
  });
  it("rewards length and action verbs", () => {
    const long = "You are a helpful assistant. ".repeat(20);
    const r = promptQuality(long + " Your job is to help. You must always be polite.");
    expect(r.score).toBeGreaterThan(40);
  });
  it("rewards examples and variables", () => {
    const p = "You are an agent. " + "x".repeat(220) + " For example: hi. {{name}}";
    expect(promptQuality(p).score).toBeGreaterThan(70);
  });
  it("returns label Excellent for high score", () => {
    const p = "You are an agent. Your job is to qualify leads. You must respond politely. " +
      "x".repeat(500) + " For example: hi. {{name}}";
    expect(promptQuality(p).label).toBe("Excellent");
  });
});
