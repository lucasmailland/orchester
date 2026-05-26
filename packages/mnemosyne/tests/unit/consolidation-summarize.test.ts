// packages/mnemosyne/tests/unit/consolidation-summarize.test.ts
//
// Pure unit tests for the consolidation summariser's prompt builder.
// The DB-touching `consolidateCluster` integration coverage lives in
// `tests/integration/consolidation.spec.ts`; this file pins the
// prompt SHAPE so a refactor that drops the numbered list or
// truncation cap is loudly caught.
import { describe, it, expect } from "vitest";
import { __testing__ } from "../../src/consolidation/summarize";
import type { MnemoFact } from "../../src/primitives/fact";
import type { ConsolidationCluster } from "../../src/consolidation/cluster";

function fact(id: string, statement: string): MnemoFact {
  const now = new Date("2026-05-25T00:00:00Z");
  return {
    id,
    workspaceId: "ws_test",
    agentId: null,
    scope: "global",
    scopeRef: null,
    kind: "preference",
    subject: "user",
    statement,
    confidence: 0.8,
    pinned: false,
    relevance: 0.9,
    hitCount: 0,
    lastRecalledAt: null,
    sourceMessageIds: [],
    attributedTo: null,
    linkedMemoryIds: [],
    embedding: null,
    metadata: {},
    status: "active",
    mergedIntoId: null,
    validFrom: now,
    validTo: null,
    createdAt: now,
    updatedAt: now,
  };
}

const cluster = (n: number): ConsolidationCluster => ({
  subject: "user",
  kind: "preference",
  members: Array.from({ length: n }, (_, i) => fact(`mfact_${i}`, `statement ${i}`)),
  cosineMin: 0.85,
});

describe("consolidation/summarize — buildPrompt", () => {
  it("includes subject + kind + numbered inputs", () => {
    const p = __testing__.buildPrompt(cluster(4));
    expect(p).toMatch(/Subject: user/);
    expect(p).toMatch(/Kind: preference/);
    expect(p).toMatch(/^1\. statement 0$/m);
    expect(p).toMatch(/^4\. statement 3$/m);
    expect(p.trim().endsWith("Consolidated sentence:")).toBe(true);
  });

  it("caps inputs at MAX_MEMBERS_IN_PROMPT", () => {
    const big = cluster(__testing__.MAX_MEMBERS_IN_PROMPT + 5);
    const p = __testing__.buildPrompt(big);
    // The 21st numbered item must NOT be present.
    expect(p).not.toMatch(/^21\. /m);
    expect(p).toMatch(new RegExp(`^${__testing__.MAX_MEMBERS_IN_PROMPT}\\. `, "m"));
  });

  it("the system prompt asks for a single sentence + size cap", () => {
    expect(__testing__.SUMMARIZER_PROMPT).toMatch(/one-sentence/);
    expect(__testing__.SUMMARIZER_PROMPT).toMatch(/200 characters/);
    expect(__testing__.SUMMARIZER_PROMPT).toMatch(/SAVED as a new memory/);
  });
});
