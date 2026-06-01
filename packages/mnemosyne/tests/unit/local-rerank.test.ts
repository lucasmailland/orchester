// packages/mnemosyne/tests/unit/local-rerank.test.ts
//
// v2 — `makeLocalLexicalRerank` is now the default reranker baked
// into the package. These tests pin its observable contract so the
// agent-runtime can rely on the package version without forking
// behavior.

import { describe, it, expect } from "vitest";
import { makeLocalLexicalRerank } from "../../src/recall/rerank";

describe("makeLocalLexicalRerank", () => {
  it("returns [] when documents is empty", async () => {
    const rerank = makeLocalLexicalRerank();
    const out = await rerank({ query: "anything", documents: [], topK: 5 });
    expect(out).toEqual([]);
  });

  it("returns [] when topK is 0", async () => {
    const rerank = makeLocalLexicalRerank();
    const out = await rerank({ query: "x", documents: ["a"], topK: 0 });
    expect(out).toEqual([]);
  });

  it("falls back to input order when the query reduces to all-stopwords", async () => {
    const rerank = makeLocalLexicalRerank();
    const docs = ["alpha", "beta", "gamma"];
    const out = await rerank({ query: "the and of", documents: docs, topK: 3 });
    expect(out).toEqual([0, 1, 2]);
  });

  it("ranks documents with more query-token hits ahead of those with fewer", async () => {
    const rerank = makeLocalLexicalRerank();
    const out = await rerank({
      query: "postgres database preferences",
      documents: [
        "user likes apples", // 0 hits
        "user prefers postgres for the database", // 2 hits
        "preferences for postgres database", // 3 hits
      ],
      topK: 3,
    });
    expect(out[0]).toBe(2); // highest overlap wins
  });

  it("is length-normalized so a long fact can't dominate via verbosity", async () => {
    const rerank = makeLocalLexicalRerank();
    const out = await rerank({
      query: "postgres",
      documents: [
        "postgres", // 1 hit / sqrt(1) = 1.0
        "the user said postgres is great because postgres is reliable and postgres", // 3 hits / sqrt(7)≈ 1.13
        "this fact is a long ramble about many topics including a tiny mention of postgres at the end of the sentence", // 1 hit / sqrt(>15)≈ 0.25
      ],
      topK: 3,
    });
    // The dense short statement should rank above the long padded one.
    expect(out.indexOf(0)).toBeLessThan(out.indexOf(2));
  });

  it("returns at most topK indices", async () => {
    const rerank = makeLocalLexicalRerank();
    const out = await rerank({
      query: "alpha",
      documents: ["alpha", "alpha alpha", "beta"],
      topK: 2,
    });
    expect(out).toHaveLength(2);
  });

  it("is deterministic — same input yields same output", async () => {
    const rerank = makeLocalLexicalRerank();
    const docs = ["x y z", "a b c", "p q r"];
    const a = await rerank({ query: "x", documents: docs, topK: 3 });
    const b = await rerank({ query: "x", documents: docs, topK: 3 });
    expect(a).toEqual(b);
  });
});
