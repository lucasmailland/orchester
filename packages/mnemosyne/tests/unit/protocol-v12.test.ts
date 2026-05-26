// packages/mnemosyne/tests/unit/protocol-v12.test.ts
//
// Mnemosyne v1.6 G2 — Memory Protocol v1.2 bump tests.
//
// Covers:
//   • MEMORY_PROTOCOL_VERSION is "v1.2.0".
//   • MEMORY_PROTOCOL_V2 contains the entity awareness paragraph + the
//     per-user privacy paragraph.
//   • MEMORY_PROTOCOL_V1 aliases V2 (no breaking import change).
//   • MEMORY_PROTOCOL_V1_1 preserves the verbatim v1.1 text (no
//     entity / per-user paragraphs).
//   • MEMORY_PROTOCOL_V1_LEGACY still holds the v1.0 text.
import { describe, it, expect } from "vitest";
import {
  MEMORY_PROTOCOL_V1,
  MEMORY_PROTOCOL_V2,
  MEMORY_PROTOCOL_V1_1,
  MEMORY_PROTOCOL_VERSION,
  MEMORY_PROTOCOL_V1_LEGACY,
} from "../../src/protocol/v1";

describe("protocol/v1 — v1.2 bump", () => {
  it("MEMORY_PROTOCOL_VERSION is v1.2.0", () => {
    expect(MEMORY_PROTOCOL_VERSION).toBe("v1.2.0");
  });

  it("V2 contains the entity awareness paragraph", () => {
    expect(MEMORY_PROTOCOL_V2).toContain("Entity awareness");
    expect(MEMORY_PROTOCOL_V2).toContain("mnemo_entity");
    expect(MEMORY_PROTOCOL_V2).toMatch(/facts linked to (that |the )?entity/i);
  });

  it("V2 contains the per-user privacy paragraph", () => {
    expect(MEMORY_PROTOCOL_V2).toContain("Per-user privacy");
    expect(MEMORY_PROTOCOL_V2).toContain("actor_id");
    expect(MEMORY_PROTOCOL_V2).toContain("user_belief");
    expect(MEMORY_PROTOCOL_V2).toContain("user_stated");
    // Names a non-current user to make the redaction example concrete.
    expect(MEMORY_PROTOCOL_V2).toMatch(/Alice|Bob/);
  });

  it("V2 still documents the 4 core tools (v1.1 body preserved)", () => {
    expect(MEMORY_PROTOCOL_V2).toContain("mnemosyne_recall");
    expect(MEMORY_PROTOCOL_V2).toContain("mnemosyne_remember");
    expect(MEMORY_PROTOCOL_V2).toContain("mnemosyne_pin");
    expect(MEMORY_PROTOCOL_V2).toContain("mnemosyne_forget");
  });

  it("V1 is now an alias for V2 (zero-config migration for agent-runtime)", () => {
    expect(MEMORY_PROTOCOL_V1).toBe(MEMORY_PROTOCOL_V2);
  });

  it("V1_1 preserves the verbatim v1.1 text (no v1.2 paragraphs)", () => {
    expect(MEMORY_PROTOCOL_V1_1).toContain("mnemosyne_recall");
    expect(MEMORY_PROTOCOL_V1_1).not.toContain("Entity awareness");
    expect(MEMORY_PROTOCOL_V1_1).not.toContain("Per-user privacy");
    expect(MEMORY_PROTOCOL_V1_1).not.toContain("mnemo_entity");
  });

  it("V1_LEGACY (v1.0.0) is still preserved", () => {
    expect(MEMORY_PROTOCOL_V1_LEGACY).toContain("Memory Protocol v1.0.0");
    expect(MEMORY_PROTOCOL_V1_LEGACY).toContain("mnemosyne_save_fact");
  });

  it("V2 stays compact (~120 tokens / under ~1800 chars)", () => {
    expect(MEMORY_PROTOCOL_V2.length).toBeLessThan(2000);
    expect(MEMORY_PROTOCOL_V2.length).toBeGreaterThan(900);
  });
});
