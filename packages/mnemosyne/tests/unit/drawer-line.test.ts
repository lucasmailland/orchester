// packages/mnemosyne/tests/unit/drawer-line.test.ts
//
// Unit tests for #13 — virtual line numbering.
//
// We cannot call `searchMnemo` without a DB, but we CAN:
//   • Test `renderFactsCompact` with `showDrawerLine: true` via mock MnemoFact values
//   • Verify the MnemoFact interface accepts `drawerLine`
//   • Test the render annotation format (prose + structured)

import { describe, it, expect } from "vitest";
import { renderFactsCompact } from "../../src/recall/render";
import type { MnemoFact } from "../../src/primitives/fact";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeFact(overrides: Partial<MnemoFact> = {}): MnemoFact {
  return {
    id: "fact1",
    workspaceId: "ws1",
    agentId: null,
    scope: "global",
    scopeRef: null,
    kind: "preference",
    subject: "Alice",
    statement: "Alice prefers TypeScript over JavaScript",
    confidence: 0.9,
    pinned: false,
    relevance: 0.8,
    hitCount: 2,
    lastRecalledAt: null,
    sourceMessageIds: [],
    attributedTo: null,
    linkedMemoryIds: [],
    embedding: null,
    metadata: {},
    status: "active",
    mergedIntoId: null,
    validFrom: new Date("2026-01-01"),
    validTo: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    memoryType: "semantic",
    attribution: "inferred",
    entityId: "entity-alice",
    drawerLine: null,
    ...overrides,
  };
}

// ── prose format ─────────────────────────────────────────────────────────────

describe("renderFactsCompact — prose with showDrawerLine (#13)", () => {
  it("annotates a fact with drawerLine in prose format", () => {
    const out = renderFactsCompact([makeFact({ drawerLine: 3 })], {
      format: "prose",
      showDrawerLine: true,
    });
    expect(out).toContain("(#3)");
    expect(out).toMatch(/Alice \(#3\):/);
  });

  it("omits annotation when drawerLine is null", () => {
    const out = renderFactsCompact([makeFact({ drawerLine: null })], {
      format: "prose",
      showDrawerLine: true,
    });
    expect(out).not.toContain("(#");
  });

  it("omits annotation when showDrawerLine is false (default)", () => {
    const out = renderFactsCompact([makeFact({ drawerLine: 5 })], { format: "prose" });
    expect(out).not.toContain("(#");
  });

  it("annotates multiple facts with different line numbers", () => {
    const facts = [
      makeFact({ id: "f1", drawerLine: 1, statement: "Alice prefers TypeScript over Python" }),
      makeFact({
        id: "f2",
        drawerLine: 3,
        subject: "Bob",
        statement: "Bob likes Python over Java",
        entityId: "entity-bob",
      }),
    ];
    const out = renderFactsCompact(facts, { format: "prose", showDrawerLine: true });
    expect(out).toContain("Alice (#1):");
    expect(out).toContain("Bob (#3):");
  });

  it("unaffiliated fact (no entity) with null drawerLine has no annotation", () => {
    const out = renderFactsCompact([makeFact({ entityId: null, drawerLine: null })], {
      format: "prose",
      showDrawerLine: true,
    });
    expect(out).not.toContain("(#");
  });
});

// ── structured format ─────────────────────────────────────────────────────────

describe("renderFactsCompact — structured with showDrawerLine (#13)", () => {
  it("prefixes kv group with (#N) when showDrawerLine is true", () => {
    const out = renderFactsCompact([makeFact({ drawerLine: 2 })], {
      format: "structured",
      showDrawerLine: true,
    });
    expect(out).toContain("(#2)");
  });

  it("omits line prefix when showDrawerLine is false", () => {
    const out = renderFactsCompact([makeFact({ drawerLine: 2 })], {
      format: "structured",
      showDrawerLine: false,
    });
    expect(out).not.toContain("(#");
  });

  it("shows up to 3 line numbers in kv prefix for multiple facts", () => {
    const facts = [
      makeFact({ id: "f1", drawerLine: 1, statement: "Alice prefers TypeScript over Python" }),
      makeFact({ id: "f2", drawerLine: 4, statement: "Alice uses VS Code" }),
      makeFact({ id: "f3", drawerLine: 7, statement: "Alice likes React over Vue" }),
      makeFact({ id: "f4", drawerLine: 9, statement: "Alice prefers Postgres over MySQL" }),
    ];
    const out = renderFactsCompact(facts, { format: "structured", showDrawerLine: true });
    // At most 3 numbers in the prefix — capped to avoid a prefix longer than the content.
    const match = out.match(/\(#\d+(?:,#\d+)*\)/);
    expect(match).not.toBeNull();
    const numbers = match![0]!.match(/#\d+/g) ?? [];
    expect(numbers.length).toBeLessThanOrEqual(3);
  });

  it("fallback prose line includes (#N) for unextractable facts", () => {
    // "relationship" kind has no extractor → falls back to prose inline.
    const out = renderFactsCompact([makeFact({ kind: "relationship", drawerLine: 6 })], {
      format: "structured",
      showDrawerLine: true,
    });
    expect(out).toContain("(#6)");
  });
});

// ── MnemoFact interface ───────────────────────────────────────────────────────

describe("MnemoFact.drawerLine field (#13)", () => {
  it("accepts drawerLine as a number", () => {
    const f = makeFact({ drawerLine: 5 });
    expect(f.drawerLine).toBe(5);
  });

  it("accepts drawerLine as null", () => {
    const f = makeFact({ drawerLine: null });
    expect(f.drawerLine).toBeNull();
  });

  it("accepts drawerLine as undefined (legacy fact)", () => {
    const { drawerLine: _dl, ...rest } = makeFact();
    const legacy: MnemoFact = rest;
    expect(legacy.drawerLine).toBeUndefined();
  });
});
