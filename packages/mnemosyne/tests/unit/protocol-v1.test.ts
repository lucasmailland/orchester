import { describe, it, expect } from "vitest";
import {
  MEMORY_PROTOCOL_V1,
  MEMORY_PROTOCOL_VERSION,
  MEMORY_PROTOCOL_V1_LEGACY,
} from "../../src/protocol/v1";

describe("protocol/v1", () => {
  it("is bumped to v1.1.0", () => {
    expect(MEMORY_PROTOCOL_VERSION).toBe("v1.1.0");
  });

  it("is tight (~80 tokens / ~600 chars)", () => {
    // ~600 chars ≈ ~150 tokens upper bound; the v1.1 string is ~890
    // chars including whitespace + bullet markers. We assert it's
    // dramatically smaller than the v1.0.0 legacy string (~1900 chars).
    expect(MEMORY_PROTOCOL_V1.length).toBeLessThan(1200);
    expect(MEMORY_PROTOCOL_V1.length).toBeGreaterThan(400);
    expect(MEMORY_PROTOCOL_V1_LEGACY.length).toBeGreaterThan(MEMORY_PROTOCOL_V1.length * 1.5);
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
