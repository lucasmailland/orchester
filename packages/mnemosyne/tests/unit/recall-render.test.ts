// packages/mnemosyne/tests/unit/recall-render.test.ts
//
// Unit tests for `renderFactsCompact`. Pure-function tests — no DB,
// no LLM, no embedding. Validates:
//   • structured grouping by kind
//   • k:v extraction for the patterns the regex extractor recognises
//   • prose fallback for unrecognised statements
//   • token-budget soft cap with "(+N more)" trailer
//   • empty / single-fact edge cases
import { describe, it, expect } from "vitest";
import { renderFactsCompact } from "../../src/recall/render";
import type { MnemoFact, FactKind } from "../../src/primitives/fact";

function mkFact(partial: Partial<MnemoFact> & Pick<MnemoFact, "kind" | "statement">): MnemoFact {
  const now = new Date("2026-05-01T00:00:00Z");
  return {
    id: partial.id ?? `mfact_test_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: partial.workspaceId ?? "ws_test",
    agentId: partial.agentId ?? null,
    scope: partial.scope ?? "global",
    scopeRef: partial.scopeRef ?? null,
    kind: partial.kind,
    subject: partial.subject ?? "user",
    statement: partial.statement,
    confidence: partial.confidence ?? 0.8,
    pinned: partial.pinned ?? false,
    relevance: partial.relevance ?? 1.0,
    hitCount: partial.hitCount ?? 0,
    lastRecalledAt: partial.lastRecalledAt ?? null,
    sourceMessageIds: partial.sourceMessageIds ?? [],
    attributedTo: partial.attributedTo ?? "user",
    linkedMemoryIds: partial.linkedMemoryIds ?? [],
    embedding: partial.embedding ?? null,
    metadata: partial.metadata ?? {},
    status: partial.status ?? "active",
    mergedIntoId: partial.mergedIntoId ?? null,
    validFrom: partial.validFrom ?? now,
    validTo: partial.validTo ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}

describe("renderFactsCompact", () => {
  it("returns empty string for empty input", () => {
    expect(renderFactsCompact([])).toBe("");
  });

  it("groups by kind in structured format", () => {
    const out = renderFactsCompact([
      mkFact({ kind: "preference", statement: "prefers TypeScript over Python" }),
      mkFact({ kind: "preference", statement: "prefers Postgres over MongoDB" }),
      mkFact({ kind: "trait", statement: "based in Buenos Aires" }),
    ]);
    const lines = out.split("\n");
    // One line per kind (preference group + trait group).
    expect(lines.some((l) => l.startsWith("[preference]"))).toBe(true);
    expect(lines.some((l) => l.startsWith("[trait]"))).toBe(true);
  });

  it("condenses 'X over Y' preferences into lang:TS>Py form", () => {
    const out = renderFactsCompact([
      mkFact({ kind: "preference", statement: "prefers TypeScript over Python" }),
    ]);
    expect(out).toContain("[preference]");
    expect(out.toLowerCase()).toContain("lang:");
    expect(out.toLowerCase()).toContain("typescript>python");
  });

  it("extracts location traits to shortened codes when recognised", () => {
    const out = renderFactsCompact([
      mkFact({ kind: "trait", statement: "based in Buenos Aires and works remotely" }),
    ]);
    expect(out).toContain("[trait]");
    // Location should be shortened to AR/BA per the lookup table.
    expect(out).toContain("AR/BA");
  });

  it("extracts event dates", () => {
    const out = renderFactsCompact([
      mkFact({ kind: "event", statement: "series A scheduled for 2026-03-15" }),
    ]);
    expect(out).toContain("[event]");
    expect(out).toContain("2026-03-15");
  });

  it("falls back to prose for kinds without an extractor", () => {
    const out = renderFactsCompact([
      mkFact({
        kind: "concern",
        subject: "user",
        statement: "worried about compliance deadlines",
      }),
    ]);
    expect(out).toBe("[concern] user: worried about compliance deadlines");
  });

  it("falls back to prose for preference statements that don't match any pattern", () => {
    const out = renderFactsCompact([
      mkFact({
        kind: "preference",
        subject: "user",
        statement: "the morning sunlight feels different in autumn",
      }),
    ]);
    // Should NOT crash. Should contain the original statement as a
    // prose fallback for this single fact.
    expect(out).toContain("[preference]");
    expect(out).toContain("user:");
  });

  it("respects the maxTokensApprox soft cap", () => {
    // Each prose line is ~50 chars ≈ 13 tokens; cap at 20 tokens →
    // only the first line should fit.
    const facts = [
      mkFact({
        kind: "concern",
        statement: "alpha alpha alpha alpha alpha alpha alpha alpha alpha alpha",
      }),
      mkFact({
        kind: "concern",
        statement: "beta beta beta beta beta beta beta beta beta beta",
      }),
      mkFact({
        kind: "concern",
        statement: "gamma gamma gamma gamma gamma gamma gamma gamma gamma gamma",
      }),
    ];
    const out = renderFactsCompact(facts, { maxTokensApprox: 20 });
    // The "(+N more)" trailer must appear when we truncated.
    expect(out).toMatch(/\(\+\d+ more\)/);
  });

  it("renders prose format when explicitly requested", () => {
    const out = renderFactsCompact(
      [mkFact({ kind: "preference", statement: "prefers TypeScript over Python" })],
      { format: "prose" }
    );
    // Prose format preserves the full original statement verbatim,
    // unlike structured which condenses to k:v.
    expect(out).toContain("prefers TypeScript over Python");
  });

  it("does not crash on a kind it doesn't specialise for (skill)", () => {
    const out = renderFactsCompact([
      mkFact({ kind: "skill" as FactKind, statement: "uses Rust for systems code" }),
    ]);
    // Skill uses the preference extractor → matches "uses Rust" → key:lang.
    expect(out).toContain("[skill]");
  });

  it("deduplicates identical k:v signatures within a kind", () => {
    const facts = [
      mkFact({ kind: "preference", statement: "prefers TypeScript over Python" }),
      mkFact({ kind: "preference", statement: "prefers TypeScript over Python" }),
    ];
    const out = renderFactsCompact(facts);
    // The k:v "lang:typescript>python" should only appear ONCE in the
    // structured line even though the input has the same pair twice.
    const matches = out.match(/typescript>python/gi);
    expect(matches?.length).toBe(1);
  });
});
