import { describe, it, expect } from "vitest";
import { MEMORY_PROTOCOL_V1, MEMORY_PROTOCOL_VERSION } from "../../src/protocol/v1";

describe("protocol/v1", () => {
  it("exports a versioned constant", () => {
    expect(MEMORY_PROTOCOL_VERSION).toBe("v1.0.0");
  });

  it("includes all CORE TOOLS section markers", () => {
    expect(MEMORY_PROTOCOL_V1).toContain("CORE TOOLS");
    expect(MEMORY_PROTOCOL_V1).toContain("mnemosyne_recall");
    expect(MEMORY_PROTOCOL_V1).toContain("mnemosyne_save_fact");
    expect(MEMORY_PROTOCOL_V1).toContain("mnemosyne_save_decision");
    expect(MEMORY_PROTOCOL_V1).toContain("mnemosyne_judge");
  });

  it("includes TRIGGERS section", () => {
    expect(MEMORY_PROTOCOL_V1).toContain("TRIGGERS");
    expect(MEMORY_PROTOCOL_V1).toContain("durable preference");
    expect(MEMORY_PROTOCOL_V1).toContain("decision made");
  });

  it("includes SELF-CHECK reminder", () => {
    expect(MEMORY_PROTOCOL_V1).toContain("SELF-CHECK");
  });

  it("includes CONFLICT REVIEW guidance", () => {
    expect(MEMORY_PROTOCOL_V1).toContain("CONFLICT REVIEW");
    expect(MEMORY_PROTOCOL_V1).toContain("mnemosyne_judge");
  });
});
