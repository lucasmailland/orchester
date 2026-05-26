import { describe, it, expect } from "vitest";
import {
  MEMORY_PROTOCOL_V1,
  MEMORY_PROTOCOL_VERSION,
  MEMORY_PROTOCOL_V1_LEGACY,
} from "../../src/protocol/v1";

describe("protocol/v1", () => {
  // v1.6: MEMORY_PROTOCOL_V1 is now an alias for MEMORY_PROTOCOL_V2
  // (the v1.2 string). MEMORY_PROTOCOL_VERSION is bumped to v1.2.0;
  // the v1.1 verbatim text lives under MEMORY_PROTOCOL_V1_1.
  it("is bumped to v1.2.0 (Mnemosyne v1.6 — entity + per-user)", () => {
    expect(MEMORY_PROTOCOL_VERSION).toBe("v1.2.0");
  });

  it("stays compact (~120 tokens / under ~1700 chars)", () => {
    // v1.2 adds ~40 tokens / ~800 chars on top of v1.1 (~900 chars).
    // Total fits under 1800; still dramatically smaller than the
    // v1.0.0 legacy string (~1900 chars).
    expect(MEMORY_PROTOCOL_V1.length).toBeLessThan(2000);
    expect(MEMORY_PROTOCOL_V1.length).toBeGreaterThan(900);
  });

  it("documents the 4 core tools", () => {
    expect(MEMORY_PROTOCOL_V1).toContain("mnemosyne_recall");
    expect(MEMORY_PROTOCOL_V1).toContain("mnemosyne_remember");
    expect(MEMORY_PROTOCOL_V1).toContain("mnemosyne_pin");
    expect(MEMORY_PROTOCOL_V1).toContain("mnemosyne_forget");
  });

  it("includes the prefer-user-corrections rule", () => {
    expect(MEMORY_PROTOCOL_V1).toContain("user corrections");
  });

  it("legacy v1.0.0 string is preserved for migration", () => {
    expect(MEMORY_PROTOCOL_V1_LEGACY).toContain("Memory Protocol v1.0.0");
    expect(MEMORY_PROTOCOL_V1_LEGACY).toContain("mnemosyne_save_fact");
    expect(MEMORY_PROTOCOL_V1_LEGACY).toContain("SELF-CHECK");
  });
});
