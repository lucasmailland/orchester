import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let saveFactWithCandidates: typeof import("../../src/conflict/fact-candidate").saveFactWithCandidates;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ saveFactWithCandidates } = await import("../../src/conflict/fact-candidate"));
  ({ withMnemoTx } = await import("../../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

describe("conflict/fact-candidate", () => {
  it("surfaces same-subject candidate with judgmentRequired=true", async () => {
    // First fact: user prefers X
    await withMnemoTx(wsA.id, (tx) =>
      saveFactWithCandidates({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "lucas-candidate-test-1",
        statement: "prefers dark mode in editors",
        tx,
      })
    );

    // Second fact: same subject, different statement (no token overlap)
    const result = await withMnemoTx(wsA.id, (tx) =>
      saveFactWithCandidates({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "lucas-candidate-test-1",
        statement: "uses light theme everywhere",
        tx,
      })
    );

    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.judgmentRequired).toBe(true);
    const sameSubject = result.candidates.find((c) => c.reason === "same_subject");
    expect(sameSubject).toBeDefined();
    expect(sameSubject?.candidate.statement).toBe("prefers dark mode in editors");
    expect(result.newFact.id).toMatch(/^mfact_/);
  });

  it("returns judgmentRequired=false when FTS finds nothing and subject is unique", async () => {
    const result = await withMnemoTx(wsA.id, (tx) =>
      saveFactWithCandidates({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: `lucas-candidate-unique-${Date.now()}`,
        statement: "ZZQXW QZXQZX QQQZZZ ABCDEFG HIJKLMN OPQRSTU VWXYZA",
        tx,
      })
    );
    expect(result.judgmentRequired).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.newFact.id).toMatch(/^mfact_/);
  });

  it("respects ftsThreshold for low-rank FTS hits", async () => {
    // Insert a fact whose statement shares a common token but is on a
    // different subject. A high threshold should keep judgmentRequired
    // false even if FTS finds the row.
    await withMnemoTx(wsA.id, (tx) =>
      saveFactWithCandidates({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "unrelated-subject-A",
        statement: "the special word zebraflux is mentioned here",
        tx,
      })
    );

    const result = await withMnemoTx(wsA.id, (tx) =>
      saveFactWithCandidates({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "unrelated-subject-B",
        statement: "the special word zebraflux is also here",
        ftsThreshold: 0.99, // impossibly high
        tx,
      })
    );

    // Candidate may still be returned, but judgment shouldn't be required.
    expect(result.judgmentRequired).toBe(false);
  });
});
