// packages/mnemosyne/tests/integration/review-queue.spec.ts
//
// Integration tests for the v1.3 active-learning review queue.
//
// Strategy:
//   1. saveFactWithCandidates with enqueueOnNoJudge: true on a
//      same-subject contradiction → enqueues a 'contradiction' row.
//   2. findLowConfidenceCandidates over a seeded mix → only the
//      low-conf, non-pinned, never-queued facts come back.
//   3. resolveReview is idempotent — second resolve is a no-op and
//      reports `resolved: false`.
//   4. enqueueReview dedups by (workspace_id, fact_id) when the
//      existing row is OPEN.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;
let createFact: typeof import("../../src/primitives/fact").createFact;
let saveFactWithCandidates: typeof import("../../src/conflict/fact-candidate").saveFactWithCandidates;
let enqueueReview: typeof import("../../src/review/queue").enqueueReview;
let listReview: typeof import("../../src/review/queue").listReview;
let resolveReview: typeof import("../../src/review/queue").resolveReview;
let findLowConfidenceCandidates: typeof import("../../src/review/queue").findLowConfidenceCandidates;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ saveFactWithCandidates } = await import("../../src/conflict/fact-candidate"));
  ({ enqueueReview, listReview, resolveReview, findLowConfidenceCandidates } =
    await import("../../src/review/queue"));
});

afterAll(() => teardownTestWorkspaces());

describe("review/queue — integration", () => {
  it("saveFactWithCandidates with enqueueOnNoJudge enqueues 'contradiction' row", async () => {
    // First fact: establish a same-subject baseline.
    await withMnemoTx(wsA.id, (tx) =>
      saveFactWithCandidates({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "review-spec-subject-1",
        statement: "prefers dark mode in editors",
        tx,
      })
    );

    // Second fact: same subject → judgmentRequired=true.
    const result = await withMnemoTx(wsA.id, (tx) =>
      saveFactWithCandidates({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "review-spec-subject-1",
        statement: "uses light theme everywhere",
        enqueueOnNoJudge: true,
        tx,
      })
    );

    expect(result.judgmentRequired).toBe(true);
    expect(result.enqueuedReviewId).not.toBeNull();
    expect(result.enqueuedReviewId).toMatch(/^mrev_/);

    // Verify the row is visible via listReview.
    const queue = await withMnemoTx(wsA.id, (tx) => listReview({ workspaceId: wsA.id, tx }));
    const row = queue.find((q) => q.id === result.enqueuedReviewId);
    expect(row).toBeDefined();
    expect(row!.reason).toBe("contradiction");
    expect(row!.factId).toBe(result.newFact.id);
    expect(row!.resolvedAt).toBeNull();
  });

  it("saveFactWithCandidates without enqueueOnNoJudge does NOT enqueue", async () => {
    // Reuse the same subject so judgmentRequired stays true.
    const result = await withMnemoTx(wsA.id, (tx) =>
      saveFactWithCandidates({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "review-spec-subject-1",
        statement: "yet another conflicting statement",
        tx,
      })
    );
    expect(result.judgmentRequired).toBe(true);
    expect(result.enqueuedReviewId).toBeNull();
  });

  it("enqueueReview dedups when an open row already exists", async () => {
    // Seed a fact and queue it twice — second call must return inserted=false.
    const factId = await withMnemoTx(wsA.id, async (tx) => {
      const f = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "review-spec-dedup",
        statement: "review-spec dedup target — unique enough to avoid FTS noise",
        tx,
      });
      return f.id;
    });

    const first = await withMnemoTx(wsA.id, (tx) =>
      enqueueReview({ workspaceId: wsA.id, factId, reason: "manual", tx })
    );
    expect(first.inserted).toBe(true);

    const second = await withMnemoTx(wsA.id, (tx) =>
      enqueueReview({ workspaceId: wsA.id, factId, reason: "low_confidence", tx })
    );
    expect(second.inserted).toBe(false);
    // Same id returned — the existing row.
    expect(second.id).toBe(first.id);
  });

  it("resolveReview marks the row and is idempotent on re-resolve", async () => {
    // Fresh fact + queue row.
    const factId = await withMnemoTx(wsA.id, async (tx) => {
      const f = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "review-spec-resolve",
        statement: "review-spec resolve target — also unique",
        tx,
      });
      return f.id;
    });
    const { id: reviewId } = await withMnemoTx(wsA.id, (tx) =>
      enqueueReview({ workspaceId: wsA.id, factId, reason: "manual", tx })
    );

    const r1 = await withMnemoTx(wsA.id, (tx) =>
      resolveReview({
        workspaceId: wsA.id,
        reviewId,
        resolvedByUserId: wsA.ownerId,
        resolution: "kept",
        tx,
      })
    );
    expect(r1.resolved).toBe(true);
    expect(r1.factId).toBe(factId);

    // Second resolve: row is no longer OPEN, must return resolved=false.
    const r2 = await withMnemoTx(wsA.id, (tx) =>
      resolveReview({
        workspaceId: wsA.id,
        reviewId,
        resolvedByUserId: wsA.ownerId,
        resolution: "kept",
        tx,
      })
    );
    expect(r2.resolved).toBe(false);
    // factId is still returned (the row exists, just resolved).
    expect(r2.factId).toBe(factId);
  });

  it("findLowConfidenceCandidates filters by confidence + pinned + open-queue", async () => {
    // Seed three facts:
    //   • low-conf, not pinned, not queued → should appear
    //   • low-conf, PINNED → must NOT appear
    //   • low-conf, not pinned, ALREADY queued open → must NOT appear
    //   • high-conf, not pinned, not queued → must NOT appear (above threshold)
    const ids = await withMnemoTx(wsA.id, async (tx) => {
      const a = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "low-conf-eligible",
        statement: "lowconf eligible candidate one for the sweep",
        confidence: 0.3,
        tx,
      });
      const b = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "low-conf-pinned",
        statement: "lowconf pinned should be skipped by sweep",
        confidence: 0.2,
        pinned: true,
        tx,
      });
      const c = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "low-conf-already-queued",
        statement: "lowconf already queued is skipped",
        confidence: 0.4,
        tx,
      });
      await enqueueReview({
        workspaceId: wsA.id,
        factId: c.id,
        reason: "manual",
        tx,
      });
      const d = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "high-conf",
        statement: "highconf is above the threshold and skipped",
        confidence: 0.9,
        tx,
      });
      return { a: a.id, b: b.id, c: c.id, d: d.id };
    });

    const candidates = await withMnemoTx(wsA.id, (tx) =>
      findLowConfidenceCandidates({ workspaceId: wsA.id, tx })
    );
    const ourSet = candidates.filter((x) => Object.values(ids).includes(x.factId));
    expect(ourSet.map((x) => x.factId)).toContain(ids.a);
    expect(ourSet.map((x) => x.factId)).not.toContain(ids.b);
    expect(ourSet.map((x) => x.factId)).not.toContain(ids.c);
    expect(ourSet.map((x) => x.factId)).not.toContain(ids.d);
  });

  it("RLS: cross-workspace enqueueReview is blocked by FORCE", async () => {
    // Seed a fact in wsA. Then try to enqueue under wsA's id from a
    // tx pinned to a different workspace — RLS should reject (the
    // INSERT WITH CHECK doesn't permit a row whose workspace_id !=
    // GUC).
    const factId = await withMnemoTx(wsA.id, async (tx) => {
      const f = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "rls-cross-spec",
        statement: "rls cross-workspace probe — should not insert",
        tx,
      });
      return f.id;
    });

    const wsBId = `${wsA.id}_other_${Date.now()}`;
    // Don't create the workspace row — withMnemoTx just sets the GUC.
    // The INSERT's WITH CHECK = (workspace_id = GUC) means inserting
    // `workspaceId: wsA.id` while the GUC is wsBId must fail.
    let threw: Error | null = null;
    try {
      await withMnemoTx(wsBId, (tx) =>
        enqueueReview({
          workspaceId: wsA.id, // mismatched on purpose
          factId,
          reason: "manual",
          tx,
        })
      );
    } catch (e) {
      threw = e as Error;
    }
    expect(threw).not.toBeNull();
    // Postgres surfaces this as new row violates row-level security
    // policy. Asserting on the message text is hostile to error-text
    // drift; the throw alone is sufficient.

    // And confirm via sql that no row landed in wsA's queue under that fact.
    await withMnemoTx(wsA.id, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT id FROM mnemo_review_queue
        WHERE workspace_id = ${wsA.id} AND fact_id = ${factId}
      `)) as unknown as Array<{ id: string }>;
      expect(rows.length).toBe(0);
    });
  });
});
