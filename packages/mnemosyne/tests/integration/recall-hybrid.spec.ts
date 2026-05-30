// packages/mnemosyne/tests/integration/recall-hybrid.spec.ts
//
// Mnemosyne v1.1 — #3: BM25+vector fusion in the vector branch of
// `runFirstStage`. Before v1.1 the vector branch was pure cosine; for
// code/log/diff queries (noisy embeddings, strong lexical signal) this
// failed silently. The fix fuses ts_rank_cd into the first-stage score:
//   hybrid = 0.7 · semantic + 0.3 · min(1, fts_rank_cd)
// and substitutes `hybrid` for `semantic` in the existing weighted
// formula (other weights unchanged).
//
// What we assert here: a fact that hits BOTH the lexical and the
// semantic channel must rank above a fact that hits only one. The
// "both" candidate is the whole point of the fusion — if the
// implementation regressed back to pure cosine, the "semantic-only"
// candidate would win whenever its embedding is closer to the query.
//
// Seeding strategy (3 facts, all in the same workspace):
//   (a) LEXICAL-ONLY  — statement matches the query verbatim; embedding
//       deliberately orthogonal (different topic anchor).
//   (b) SEMANTIC-ONLY — embedding matches the query (same topic anchor);
//       statement carries no query-token overlap.
//   (c) BOTH          — statement matches lexically AND embedding shares
//       the query's topic anchor.
//
// We then query with both an `embedFn` (Mode B) and a lexical query
// string carrying the shared token, and assert: rank(c) < rank(a) and
// rank(c) < rank(b). If the fusion is missing, (b) outranks (c) — the
// embedding-only candidate is closer in cosine because (c) has the same
// anchor PLUS jitter, and the legacy formula sees no fts contribution.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

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
let searchMnemo: typeof import("../../src/recall/search").searchMnemo;

const TEST_DIM = 1536;

// Deterministic topic-anchored embedder mirroring the pattern used in
// halfvec-recall-quality.spec.ts. Two anchors here ("query-topic" vs
// "off-topic"); the "off-topic" one is what we give to the lexical-only
// fact so its cosine to the query vector is near-zero.
function lcgSeed(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h || 1;
}

function topicAnchor(topic: string): number[] {
  let s = lcgSeed(`anchor:${topic}`);
  const raw = new Array<number>(TEST_DIM);
  for (let i = 0; i < TEST_DIM; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    raw[i] = (s / 0x100000000) * 2 - 1;
  }
  return normalize(raw);
}

function fakeVectorFor(text: string, topic: string, jitter = 0.15): number[] {
  const anchor = topicAnchor(topic);
  let s = lcgSeed(text);
  const raw = new Array<number>(TEST_DIM);
  for (let i = 0; i < TEST_DIM; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const noise = ((s / 0x100000000) * 2 - 1) * jitter;
    raw[i] = anchor[i]! + noise;
  }
  return normalize(raw);
}

function normalize(v: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ searchMnemo } = await import("../../src/recall/search"));
});

afterAll(() => teardownTestWorkspaces());

describe("recall/search — v1.1 #3 BM25+vector fusion (vector branch)", () => {
  it("ranks both-match above lexical-only and semantic-only", async () => {
    // The shared lexical token "diffstacktrace" is a unique non-dictionary
    // word so plainto_tsquery('simple') tokenizes it cleanly without
    // stemming surprises. It appears in (a) and (c), but NOT (b).
    const LEX_TOKEN = "diffstacktrace";
    const QUERY_TEXT = `${LEX_TOKEN} parsing failure`;
    const QUERY_TOPIC = "kafka-consumer-lag";
    const OFF_TOPIC = "victorian-poetry";

    // (a) lexical-only: statement carries the query token (multiple
    //     occurrences to give ts_rank_cd a strong signal); embedding
    //     anchored to an unrelated topic so cosine is near-zero.
    const lexOnlyText = `${LEX_TOKEN} ${LEX_TOKEN} appears in the legacy parser output for ${LEX_TOKEN}`;
    const lexOnlyEmbedding = fakeVectorFor(lexOnlyText, OFF_TOPIC);

    // (b) semantic-only: statement carries NO query token; embedding
    //     shares the query topic anchor. Higher jitter (0.30) so the
    //     cosine is high but not so close to the query that no realistic
    //     fts-fusion bump could ever overcome it — without that headroom
    //     the test would be impossible to satisfy and we'd really just
    //     be testing the jitter parameter.
    const semOnlyText = "consumer offsets drift when partition rebalancing stalls";
    const semOnlyEmbedding = fakeVectorFor(semOnlyText, QUERY_TOPIC, 0.3);

    // (c) both: statement matches lexically (repeat the token for the
    //     same ts_rank_cd lift as (a)) AND embedding matches semantically
    //     with the SAME jitter as (b) so the only differentiator between
    //     (b) and (c) is the lexical channel — which is exactly the
    //     signal the v1.1 #3 fusion is supposed to inject.
    const bothText = `${LEX_TOKEN} ${LEX_TOKEN} surfaces when the consumer offset reset path hits ${LEX_TOKEN}`;
    const bothEmbedding = fakeVectorFor(bothText, QUERY_TOPIC, 0.3);

    let lexOnlyId = "";
    let semOnlyId = "";
    let bothId = "";

    await withMnemoTx(wsA.id, async (tx) => {
      const a = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "system",
        statement: lexOnlyText,
        embedding: lexOnlyEmbedding,
        tx,
      });
      const b = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "system",
        statement: semOnlyText,
        embedding: semOnlyEmbedding,
        tx,
      });
      const c = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "system",
        statement: bothText,
        embedding: bothEmbedding,
        tx,
      });
      lexOnlyId = a.id;
      semOnlyId = b.id;
      bothId = c.id;
    });

    // Query embedding is anchored to the SAME query topic as (b) and
    // (c). The fake embedder is deterministic, so the query vector
    // sits closer (in cosine) to (b) and (c) than to (a). Without the
    // fusion, the ranking would be determined by cosine alone and (b)
    // would frequently outrank (c) — that's exactly the bug we want to
    // catch if the fusion regresses.
    const queryVec = fakeVectorFor(QUERY_TEXT, QUERY_TOPIC);
    const embedFn = async () => ({
      vectors: [queryVec],
      model: "test-embed",
      tokensUsed: 0,
    });

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: QUERY_TEXT,
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      embedFn,
      // maxResults=5 so all three seeded facts surface and we can
      // compare their ranks directly. With the default 3 we'd still
      // see them, but explicit-5 makes the intent obvious.
      maxResults: 5,
    });

    // All three seeded facts must surface — the vector branch does NOT
    // gate on FTS match (otherwise the semantic-only fact would be
    // filtered out by the lexical search), so we expect length >= 3.
    expect(hits.length).toBeGreaterThanOrEqual(3);

    const rankOf = (id: string): number => hits.findIndex((h) => h.fact.id === id);
    const rBoth = rankOf(bothId);
    const rLex = rankOf(lexOnlyId);
    const rSem = rankOf(semOnlyId);

    // Sanity: every seeded fact is present.
    expect(rBoth).toBeGreaterThanOrEqual(0);
    expect(rLex).toBeGreaterThanOrEqual(0);
    expect(rSem).toBeGreaterThanOrEqual(0);

    // The whole point of #3 — the both-match fact must rank above the
    // single-channel matches.
    expect(rBoth).toBeLessThan(rLex);
    expect(rBoth).toBeLessThan(rSem);
  });
});
