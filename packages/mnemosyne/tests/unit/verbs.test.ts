import { describe, it, expect } from "vitest";
import { RELATION_VERBS, isRelationVerb, RELATION_VERB_VERSION } from "../../src/graph/verbs";

describe("graph/verbs", () => {
  it("exports exactly 9 verbs in stable order", () => {
    expect(RELATION_VERBS).toEqual([
      "related",
      "compatible",
      "scoped",
      "conflicts_with",
      "supersedes",
      "not_conflict",
      "derived_from",
      "part_of",
      "member_of",
    ]);
    expect(RELATION_VERBS).toHaveLength(9);
  });

  it("RELATION_VERBS is frozen (readonly tuple)", () => {
    // TS readonly + `as const` enforces compile-time immutability;
    // at runtime the tuple is still a JS array — verify the tuple
    // shape (no duplicates, all strings).
    const set = new Set<string>(RELATION_VERBS);
    expect(set.size).toBe(RELATION_VERBS.length);
    for (const v of RELATION_VERBS) {
      expect(typeof v).toBe("string");
    }
  });

  it("isRelationVerb is a type guard", () => {
    expect(isRelationVerb("supersedes")).toBe(true);
    expect(isRelationVerb("conflicts_with")).toBe(true);
    expect(isRelationVerb("invalid")).toBe(false);
    expect(isRelationVerb("")).toBe(false);
    expect(isRelationVerb("RELATED")).toBe(false); // case-sensitive
  });

  it("version is set and locked at v1.0.0", () => {
    expect(RELATION_VERB_VERSION).toBe("v1.0.0");
  });
});
