import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let saveDecisionWithCandidates: typeof import("../../src/conflict/candidate").saveDecisionWithCandidates;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ saveDecisionWithCandidates } = await import("../../src/conflict/candidate"));
  ({ withMnemoTx } = await import("../../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

describe("conflict/candidate", () => {
  it("surfaces candidates with judgmentRequired=true on save", async () => {
    // First decision establishes a topic
    await withMnemoTx(wsA.id, (tx) =>
      saveDecisionWithCandidates({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Refund policy v1",
        body: "30 days for digital goods",
        checkConflicts: "fast",
        tx,
      })
    );

    // Second similar decision should detect the first as a candidate
    const result = await withMnemoTx(wsA.id, (tx) =>
      saveDecisionWithCandidates({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Refund policy v2",
        body: "60 days for digital goods",
        checkConflicts: "fast",
        tx,
      })
    );
    expect(result.judgmentRequired).toBe(true);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.candidates[0]!.title).toContain("Refund policy");
    expect(result.candidates[0]!.judgmentId).toMatch(/^mrel_/);
  });

  it("does NOT surface candidates when checkConflicts='none'", async () => {
    const result = await withMnemoTx(wsA.id, (tx) =>
      saveDecisionWithCandidates({
        workspaceId: wsA.id,
        kind: "discovery",
        title: "Test discovery xyz",
        body: "completely new topic with no related items",
        checkConflicts: "none",
        tx,
      })
    );
    expect(result.judgmentRequired).toBe(false);
    expect(result.candidates).toEqual([]);
  });

  it("returns judgmentRequired=false when FTS finds no candidates", async () => {
    // Tokens chosen so none collide with any other test's title/body in
    // this workspace (no "refund", "policy", "test", "discovery",
    // "digital", "goods", "topic", etc.). All-caps gibberish to be safe.
    const result = await withMnemoTx(wsA.id, (tx) =>
      saveDecisionWithCandidates({
        workspaceId: wsA.id,
        kind: "learning",
        title: "ZZQXW QZXQZX QQQZZZ",
        body: "ABCDEFG HIJKLMN OPQRSTU VWXYZA BCDEFGH IJKLMNO PQRSTUV",
        checkConflicts: "fast",
        tx,
      })
    );
    expect(result.judgmentRequired).toBe(false);
    expect(result.candidates).toEqual([]);
    // Decision is still saved.
    expect(result.decision.id).toMatch(/^mdec_/);
  });
});
