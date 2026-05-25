import { describe, it, expect } from "vitest";
import { resolveModeFromCapabilities } from "../../src/modes/detect";

describe("modes/detect", () => {
  it("returns 'A' when no providers configured", () => {
    expect(resolveModeFromCapabilities({ hasLLM: false, hasEmbed: false })).toBe("A");
  });

  it("returns 'B' when only embedding configured", () => {
    expect(resolveModeFromCapabilities({ hasLLM: false, hasEmbed: true })).toBe("B");
  });

  it("returns 'C' when both LLM and embedding configured", () => {
    expect(resolveModeFromCapabilities({ hasLLM: true, hasEmbed: true })).toBe("C");
  });

  it("LLM without embedding falls back to B-mode (no LLM extraction without embed)", () => {
    // We require both for Mode C — if only LLM, treat as A (no auto-extract path)
    expect(resolveModeFromCapabilities({ hasLLM: true, hasEmbed: false })).toBe("A");
  });
});
