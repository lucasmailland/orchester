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
let listReview: typeof import("../../src/review/queue").listReview;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ saveDecisionWithCandidates } = await import("../../src/conflict/candidate"));
  ({ listReview } = await import("../../src/review/queue"));
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

  // v1.1 #24 — advisory contradiction queue wire
  it("enqueues a review row with reason='contradiction' when enqueueOnNoJudge=true", async () => {
    // Seed a base decision.
    await withMnemoTx(wsA.id, (tx) =>
      saveDecisionWithCandidates({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Queue wire base policy xzqw",
        body: "queue wire base body xzqw",
        checkConflicts: "fast",
        tx,
      })
    );

    // A conflicting decision with enqueueOnNoJudge=true.
    const result = await withMnemoTx(wsA.id, (tx) =>
      saveDecisionWithCandidates({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Queue wire conflict policy xzqw",
        body: "queue wire conflict body xzqw",
        checkConflicts: "fast",
        enqueueOnNoJudge: true,
        tx,
      })
    );

    expect(result.judgmentRequired).toBe(true);
    expect(result.enqueuedReviewId).toMatch(/^mrev_/);

    // The queue row should be visible via listReview.
    const queue = await withMnemoTx(wsA.id, (tx) =>
      listReview({ workspaceId: wsA.id, reason: "contradiction", tx })
    );
    const row = queue.find((r) => r.id === result.enqueuedReviewId);
    expect(row).toBeDefined();
    expect(row!.decisionId).toBe(result.decision.id);
    expect(row!.factId).toBeNull();
    expect(row!.reason).toBe("contradiction");
    expect(row!.resolvedAt).toBeNull();
  });

  it("does NOT enqueue when enqueueOnNoJudge is not set", async () => {
    // Seed base.
    await withMnemoTx(wsA.id, (tx) =>
      saveDecisionWithCandidates({
        workspaceId: wsA.id,
        kind: "policy",
        title: "No-enqueue base policy zqxw",
        body: "no-enqueue base body zqxw",
        checkConflicts: "fast",
        tx,
      })
    );

    const result = await withMnemoTx(wsA.id, (tx) =>
      saveDecisionWithCandidates({
        workspaceId: wsA.id,
        kind: "policy",
        title: "No-enqueue conflict policy zqxw",
        body: "no-enqueue conflict body zqxw",
        checkConflicts: "fast",
        // enqueueOnNoJudge omitted → default false
        tx,
      })
    );

    expect(result.judgmentRequired).toBe(true);
    expect(result.enqueuedReviewId).toBeNull();
  });
});
