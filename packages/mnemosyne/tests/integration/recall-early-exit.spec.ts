// packages/mnemosyne/tests/integration/recall-early-exit.spec.ts
//
// v1.1 — #7: integration test for the confidence-based rerank early-
// exit. When the post-dampener top first-stage score is >= 0.92 the
// pipeline substitutes `noopRerank` for the caller-supplied rerank to
// avoid the latency of a (likely-redundant) cross-encoder pass.
//
// We engineer a high-scoring fact by pinning a fresh, exact-match
// statement so the Mode-A formula
//     score = 0.6 * fts + 0.2 * recency + 0.1 * frequency + 0.1 * pin
// floors close to its 1.0 ceiling: recency ≈ 1 (just inserted), pin = 1,
// fts gets a strong boost from a precise tsquery hit, frequency = 0.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";
import { type RerankFn } from "../../src/recall/rerank";
import { sql } from "drizzle-orm";

let wsA: WsFixture;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;
let createFact: typeof import("../../src/primitives/fact").createFact;
let searchMnemo: typeof import("../../src/recall/search").searchMnemo;
let invalidateRecallCacheForWorkspace: typeof import("../../src/recall/cache").invalidateRecallCacheForWorkspace;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ searchMnemo } = await import("../../src/recall/search"));
  ({ invalidateRecallCacheForWorkspace } = await import("../../src/recall/cache"));
});

afterAll(() => teardownTestWorkspaces());

describe("recall/search — v1.1 confidence-based early-exit rerank (#7)", () => {
  it("calls the injected reranker when the top score is below 0.92", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    // Seed an unpinned, ordinary fact — its score will be modest
    // (no pin bonus, lossy fts) so the early-exit guard does NOT fire.
    await withMnemoTx(wsA.id, async (tx) => {
      await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "weakmatch_marker_one: the user has a preference for examples",
        tx,
      });
      await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "weakmatch_marker_two: more text to dilute the rank",
        tx,
      });
    });

    const rerank: RerankFn = vi.fn(async ({ documents, topK }) => {
      const n = Math.min(documents.length, topK);
      const out: number[] = [];
      for (let i = 0; i < n; i++) out.push(i);
      return out;
    });

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      // Two content words → dampener does NOT fire. Multi-doc match
      // keeps top score well under 0.92.
      query: "weakmatch examples",
      rerank,
      maxResults: 3,
    });

    expect(hits.length).toBeGreaterThan(0);
    // Caller's rerank ran — confirms #7 didn't short-circuit.
    expect(rerank).toHaveBeenCalledTimes(1);
    // And the top score is indeed < 0.92 — locks in the test's premise.
    expect(hits[0]?.score).toBeLessThan(0.92);
  });

  it("SKIPS the injected reranker when the top score is >= 0.92", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    // Engineer a near-ceiling score: pinned (+0.1), fresh (+~0.2),
    // and a query that's a precise exact-token match against a very
    // short statement so ts_rank_cd lands high (Mode-A clamps at 1).
    // The seeded statement is one token only — `plainto_tsquery` of
    // the same token against a single-token doc yields the highest
    // ts_rank_cd available for the corpus.
    await withMnemoTx(wsA.id, async (tx) => {
      const created = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        // Two-token doc so a two-token tsquery still matches every
        // token (plainto_tsquery ANDs them). Both tokens are unique
        // synthetic words → no other workspace row competes.
        statement: "earlyexitmarker earlyexitanchor",
        pinned: true,
        tx,
      });
      // Bump hit_count so the frequency term (ln(1+n)/ln(100)) reaches
      // ~1.0. The Mode-A formula is 0.6*fts + 0.2*recency + 0.1*freq
      // + 0.1*pin. ts_rank_cd on a 2-token query against a 2-token
      // doc is small (~0.1) but combined with pin (0.1) + recency
      // (~1 just-inserted → 0.2) + maxed freq (~0.1) we want a total
      // >= 0.92. We need to inflate the fts contribution too — done
      // below by padding the doc text with marker repetitions so
      // ts_rank_cd's `idf * tf` lands much higher. Drizzle update via
      // raw SQL — the fact id comes from `createFact`'s return shape.
      // text_lemmatized is a GENERATED column — updating `statement`
      // is enough; Postgres recomputes the tsvector for us.
      await tx.execute(sql`
        UPDATE mnemo_fact
        SET hit_count = 99,
            statement = repeat('earlyexitmarker earlyexitanchor ', 50)
        WHERE id = ${created.id}
      `);
    });

    const rerank: RerankFn = vi.fn(async ({ documents, topK }) => {
      const n = Math.min(documents.length, topK);
      const out: number[] = [];
      for (let i = 0; i < n; i++) out.push(i);
      return out;
    });

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      // Two content words avoid the #4 dampener (which would otherwise
      // multiply by 0.6 and push the top score below the 0.92 cutoff).
      // Both tokens are present in the seeded statement so the AND
      // semantics of plainto_tsquery match exactly the one seeded row.
      query: "earlyexitmarker earlyexitanchor",
      rerank,
      maxResults: 3,
    });

    expect(hits.length).toBe(1);
    // Lower bound = the threshold itself. Formula drift that drops the
    // top score below 0.92 would silently bypass the early-exit and
    // falsely pass — fail loudly so the 0.92 constant gets a deliberate
    // retune rather than a silent regression.
    // NOTE: no upper bound. The test setup maximises all four scoring
    // components (pin + recency + frequency + fts via statement padding)
    // so the score legitimately approaches 1.0. An upper-bound assertion
    // on an intentionally-maximised fixture provides no useful invariant;
    // the complementary "calls the reranker when score is below 0.92" test
    // already guarantees the formula has dynamic range.
    expect(hits[0]?.score).toBeGreaterThanOrEqual(0.92);
    // The early-exit substituted noopRerank for the caller's fn.
    expect(rerank).not.toHaveBeenCalled();
  });
});
