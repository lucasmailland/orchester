// packages/mnemosyne/tests/unit/episode-types.test.ts
//
// Mnemosyne v1.4 — pure type-shape smoke test for the episode module.
//
// We don't have a hand-rollable runtime validator to exercise here (the
// `MemoryType` is enforced by the CHECK constraint at the DB layer, the
// row shapes by drizzle's typed insert). What we DO want is a guard
// that:
//   (a) the four memory-type literals stay stable (any future rename
//       will break the v1.4 contract — callers persist these values to
//       disk, the brief promises 4 specific strings),
//   (b) the public API surface remains importable from the package
//       root (regression check for the barrel export).
import { describe, it, expect } from "vitest";
import {
  createEpisode,
  getEpisode,
  listEpisodes,
  linkFactToEpisode,
  type MemoryType,
} from "../../src";

describe("episode types — surface stability", () => {
  it("MemoryType literals stay frozen (semantic | episodic | procedural | working)", () => {
    // We can't introspect a union type at runtime, but we CAN exhaust
    // every literal here — if a future refactor drops or renames one,
    // the assignment fails to compile and `tsc --noEmit` blocks the
    // PR before this test even runs.
    const all: MemoryType[] = ["semantic", "episodic", "procedural", "working"];
    expect(all).toHaveLength(4);
    expect(new Set(all).size).toBe(4);
  });

  it("public episode API is reachable from the package root", () => {
    expect(typeof createEpisode).toBe("function");
    expect(typeof getEpisode).toBe("function");
    expect(typeof listEpisodes).toBe("function");
    expect(typeof linkFactToEpisode).toBe("function");
  });
});
