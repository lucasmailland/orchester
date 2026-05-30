// packages/mnemosyne/tests/unit/recall-guidance.test.ts
//
// v1.1 #28 — MEMORY_RECALL_GUIDANCE: anti-pattern guidance for memory
// tool usage. Lives outside the version-locked protocol so we can
// iterate without invalidating stored extraction metadata.
import { describe, it, expect } from "vitest";
import { MEMORY_RECALL_GUIDANCE } from "../../src/protocol/v1";

describe("MEMORY_RECALL_GUIDANCE — #28 anti-pattern guidance", () => {
  it("is exported as a non-empty string", () => {
    expect(typeof MEMORY_RECALL_GUIDANCE).toBe("string");
    expect(MEMORY_RECALL_GUIDANCE.length).toBeGreaterThan(0);
  });

  it("mentions the canonical recall tool name", () => {
    expect(MEMORY_RECALL_GUIDANCE).toContain("mnemosyne_recall");
  });

  it("references memory_get (the per-scope bag fetch)", () => {
    expect(MEMORY_RECALL_GUIDANCE).toContain("memory_get");
  });

  it("does NOT mention non-existent tools (mnemo_get_fact)", () => {
    expect(MEMORY_RECALL_GUIDANCE).not.toContain("mnemo_get_fact");
  });

  it("stays under ~80 tokens (lenient whitespace-split sanity check)", () => {
    const wordCount = MEMORY_RECALL_GUIDANCE.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThan(80);
  });
});
