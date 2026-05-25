// packages/mnemosyne/tests/integration/recall-hyde.spec.ts
//
// Integration tests for the v1.1 query-prep stage of searchMnemo.
// Exercises:
//   • HyDE happy path: when `prepareQueryLlm` returns a hypothetical
//     answer, the embedFn is called with the hypothetical text (NOT
//     the raw question), proving the embedding-mismatch fix is live.
//   • HyDE graceful degradation: when `prepareQueryLlm` throws, the
//     pipeline falls back to the raw query and still returns results
//     (recall must never fail because of a flaky LLM).
//   • Contextualization happy path: when history is supplied and the
//     LLM returns a pronoun-resolved paraphrase, the FTS / embedding
//     uses the paraphrase.
//
// Hits real Postgres (Mode B/C path) so the embedding column round-trip
// + cosine math are exercised end-to-end.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";
import type { EmbedFn } from "../../src/recall/embed";
import type { LlmCallFn } from "../../src/recall/query-prep";

let wsA: WsFixture;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;
let createFact: typeof import("../../src/primitives/fact").createFact;
let searchMnemo: typeof import("../../src/recall/search").searchMnemo;
let invalidateRecallCacheForWorkspace: typeof import("../../src/recall/cache").invalidateRecallCacheForWorkspace;

// Deterministic 1536-dim fake embedder (mnemo_fact.embedding column
// is `vector(1536)`). We don't care about semantic correctness here —
// only that (a) two equal inputs → equal vectors, (b) the FN is called
// with the text we expect. Real pgvector handles storage + cosine.
const TEST_DIM = 1536;
function fakeVectorFor(text: string): number[] {
  // Seed a tiny LCG with djb2(text) so values are deterministic per input.
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  let s = h || 1;
  const raw = new Array<number>(TEST_DIM);
  for (let i = 0; i < TEST_DIM; i++) {
    // LCG step (numerical recipes constants) → value in [0,1).
    s = (s * 1664525 + 1013904223) >>> 0;
    raw[i] = s / 0x100000000;
  }
  let norm = 0;
  for (let i = 0; i < TEST_DIM; i++) norm += raw[i]! * raw[i]!;
  norm = Math.sqrt(norm);
  return raw.map((x) => x / norm);
}

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ searchMnemo } = await import("../../src/recall/search"));
  ({ invalidateRecallCacheForWorkspace } = await import("../../src/recall/cache"));
});

afterAll(() => teardownTestWorkspaces());

describe("recall/search — v1.1 query-prep (HyDE + contextualize)", () => {
  it("embeds the HyDE hypothetical, not the raw query, when LLM is supplied", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    // Seed a fact with a precomputed embedding (Mode B/C requires it).
    const statement = "hyde-fact: the user prefers blueberry pancakes on sundays";
    const vec = fakeVectorFor(statement);
    await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement,
        embedding: vec,
        tx,
      })
    );

    // Explicit `EmbedFn` signature so `mock.calls[N]` is a 5-tuple
    // rather than the inferred `[]` (vi.fn's zero-arg default).
    const embedSpy = vi.fn<EmbedFn>(async () => ({
      vectors: [fakeVectorFor("HYPOTHETICAL_TEXT_MARKER")],
      model: "test-embed",
      tokensUsed: 1,
    }));
    const embedFn: EmbedFn = embedSpy;

    // LLM returns a fixed hypothetical that we'll uniquely fingerprint.
    const llmSpy = vi.fn(async () => "HYPOTHETICAL_TEXT_MARKER");
    const llmCall = llmSpy as unknown as LlmCallFn;

    await searchMnemo({
      workspaceId: wsA.id,
      query: "what pancakes does the user like?",
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      embedFn,
      prepareQueryLlm: llmCall,
      enableHyDE: true,
      enableContextualize: false, // isolate to HyDE
      maxResults: 3,
    });

    // The LLM should have been called once (HyDE only).
    expect(llmSpy).toHaveBeenCalledTimes(1);
    // The embedder should have been called with the hypothetical, not the question.
    expect(embedSpy).toHaveBeenCalledTimes(1);
    const callArgs = embedSpy.mock.calls[0]!;
    // EmbedFn signature: (workspaceId, provider, model, texts, tx?)
    const texts = callArgs[3] as string[];
    expect(texts).toEqual(["HYPOTHETICAL_TEXT_MARKER"]);
  });

  it("falls back to the raw query when the LLM throws (recall must not fail)", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    const statement2 = "fallback-fact: the user enjoys mint chocolate ice cream";
    await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: statement2,
        tx,
      })
    );

    const llmSpy = vi.fn(async () => {
      throw new Error("simulated LLM outage");
    });
    const llmCall = llmSpy as unknown as LlmCallFn;
    const onError = vi.fn();

    // Mode A (no embed) so the FTS path runs against the raw query.
    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "ice cream",
      prepareQueryLlm: llmCall,
      enableHyDE: true,
      enableContextualize: true,
      // We can't pass onError into searchMnemo directly (it's on
      // QueryPrepInput) — but we still assert no throw + non-empty hits.
      maxResults: 3,
    });

    // LLM threw twice (contextualize + HyDE) — but we got results.
    expect(llmSpy.mock.calls.length).toBeGreaterThan(0);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.fact.statement.includes("ice cream"))).toBe(true);
    // onError isn't wired through searchMnemo by design (it's a
    // prepareQuery-level concern). This assertion documents that.
    expect(onError).not.toHaveBeenCalled();
  });

  it("uses the contextualized query for FTS when contextualization is enabled", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    // Seed a fact with a unique anchor word "tetrahedron" that won't
    // match the raw query "what about it?".
    await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: "user is fascinated by the tetrahedron shape",
        tx,
      })
    );

    // LLM resolves "it" → "tetrahedron".
    const llmSpy = vi.fn(async () => "tetrahedron");
    const llmCall = llmSpy as unknown as LlmCallFn;

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "what about it?",
      history: [
        { role: "user", content: "tell me about the tetrahedron" },
        { role: "assistant", content: "a tetrahedron has four faces" },
      ],
      prepareQueryLlm: llmCall,
      enableHyDE: false,
      enableContextualize: true,
      maxResults: 3,
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.fact.statement.includes("tetrahedron"))).toBe(true);
    // Contextualize ran (history.length >= 2). HyDE was disabled.
    expect(llmSpy).toHaveBeenCalledTimes(1);
  });
});
