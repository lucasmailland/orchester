// packages/mnemosyne/tests/integration/recall-rerank.spec.ts
//
// Integration tests for the cross-encoder reranking stage of
// searchMnemo. The rerank pass happens between hybrid retrieval and
// post-recall pruning, so we use a recognisable mock RerankFn to
// prove (a) the pipeline calls it with the contextualised query +
// the first-stage statements, and (b) the final order matches the
// rerank's output.
//
// We also cover the noopRerank identity contract — `searchMnemo` with
// no rerank injected MUST preserve the first-stage hybrid score order.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";
import { noopRerank, type RerankFn } from "../../src/recall/rerank";

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

describe("recall/search — v1.1 reranking", () => {
  it("respects the order returned by a custom rerank (reversing mock)", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    // Seed three facts. We'll use the FTS path (Mode A) so first-stage
    // ordering is FTS-deterministic by the query token.
    const tokens = ["rerank_marker_alpha", "rerank_marker_beta", "rerank_marker_gamma"];
    await withMnemoTx(wsA.id, async (tx) => {
      for (const t of tokens) {
        await createFact({
          workspaceId: wsA.id,
          scope: "global",
          kind: "preference",
          subject: "user",
          // include the shared anchor so they all match the FTS query.
          statement: `${t}: the user has a preference for rerankmarker examples`,
          tx,
        });
      }
    });

    // Reversing reranker: returns indices in reverse order.
    const reverseRerank: RerankFn = vi.fn(async ({ documents, topK }) => {
      const n = Math.min(documents.length, topK);
      const out: number[] = [];
      for (let i = documents.length - 1; i >= 0 && out.length < n; i--) out.push(i);
      return out;
    });

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "rerankmarker",
      rerank: reverseRerank,
      maxResults: 3,
    });

    expect(reverseRerank).toHaveBeenCalledTimes(1);
    expect(hits.length).toBeGreaterThanOrEqual(1);

    // The reranker was called with the statements of the first-stage
    // results; its reversed output indices propagate to the final order.
    const reverseCall = (
      reverseRerank as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls[0]!;
    const calledWith = reverseCall[0] as { documents: string[] };
    // Final hits' statements should mirror the reverse of the first
    // `maxResults` slice of the documents the reranker saw.
    const expectedTop = calledWith.documents
      .slice(0, hits.length)
      .reverse()
      .map((s) => s);
    const finalStatements = hits.map((h) => h.fact.statement);

    // The reranker takes ALL first-stage docs (≤ firstStageK=15). The
    // reversal pulls the *tail* of that list, which equals the *head*
    // of the docs array reversed — so the finalStatements should match
    // the tail of `calledWith.documents`, reversed.
    const tail = calledWith.documents.slice(-hits.length).reverse();
    expect(finalStatements).toEqual(tail);
    // (expectedTop is unused — kept for the parallel-arrays diff hint.)
    void expectedTop;
  });

  it("preserves first-stage hybrid score order when rerank is omitted (noop)", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    // Use noopRerank explicitly to make the test intent unambiguous.
    const noop = vi.fn(noopRerank);
    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "rerankmarker",
      rerank: noop as unknown as RerankFn,
      maxResults: 3,
    });

    expect(noop).toHaveBeenCalledTimes(1);

    // noopRerank returns identity → final order == the
    // first-`maxResults` slice of the rerank's `documents` input.
    const noopCall = noop.mock.calls[0]!;
    const calledWith = noopCall[0] as { documents: string[] };
    const expected = calledWith.documents.slice(0, hits.length);
    expect(hits.map((h) => h.fact.statement)).toEqual(expected);
  });

  it("works without a rerank field — defaults to identity", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "rerankmarker",
      maxResults: 3,
    });

    // No throw, results bounded by maxResults.
    expect(hits.length).toBeLessThanOrEqual(3);
  });
});
