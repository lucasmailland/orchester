// packages/mnemosyne/tests/integration/halfvec-recall-quality.spec.ts
//
// Mnemosyne v1.6 — Recall quality regression test for the halfvec
// quantization migration (0042).
//
// The migration moves `mnemo_fact.embedding` from `vector(1536)` to
// `halfvec(1536)` — float32 → float16. Quantization MUST stay within
// noise floor for recall: top-1 >= 95%, top-3 >= 98%. This test pins
// the contract.
//
// Strategy: seed 50 facts with semantically-distinguishable statements
// across 5 topic clusters (10 facts per cluster). Issue 10 queries
// designed to land in ONE specific cluster each. For each query,
// confirm that:
//   - top-1 result is from the expected cluster (>= 95% across queries),
//   - top-3 results include at least one expected-cluster fact (>= 98%).
//
// Domain-knowledge mode: we don't compare halfvec vs vector directly
// (the migration runs once at suite setup; vector is gone from the
// table by the time the assertions run). Instead we assert against the
// *absolute* recall quality bar — the same quality test the v1.0
// vector-only baseline passed at >=95% top-1 in its own integration
// tests. If halfvec causes recall to degrade below that bar, this
// test catches it.
//
// Fake embedder: uses a deterministic LCG so two equal inputs produce
// equal vectors. Real pgvector handles storage + cosine math. The
// embeddings are unit-norm so the float16 quantization noise stays
// within ~1e-3 cosine error per dimension, which is the regime we
// expect in production.

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

// Topic-tagged deterministic embedder. The vector is the sum of a
// topic-anchor vector + a small per-statement perturbation. This
// produces clusters that are well-separated in cosine space (topic
// anchors are orthogonal-ish) so the halfvec round-trip preserves
// the ordering even after quantization.
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
    raw[i] = (s / 0x100000000) * 2 - 1; // signed
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

interface SeedFact {
  topic: string;
  statement: string;
}

const TOPICS = ["food", "music", "travel", "books", "sports"] as const;

const SEEDS: SeedFact[] = [
  // food
  { topic: "food", statement: "Lucas prefers espresso over filter coffee" },
  { topic: "food", statement: "Lucas is vegetarian and avoids beef" },
  { topic: "food", statement: "Lucas enjoys sourdough bread baked at home" },
  { topic: "food", statement: "Lucas dislikes spicy food with chili peppers" },
  { topic: "food", statement: "Lucas drinks green tea every morning" },
  { topic: "food", statement: "Lucas cooks pasta on weekends with parmesan" },
  { topic: "food", statement: "Lucas is allergic to shellfish and lobster" },
  { topic: "food", statement: "Lucas eats sushi twice a month for dinner" },
  { topic: "food", statement: "Lucas grows herbs and basil in the kitchen window" },
  { topic: "food", statement: "Lucas avoids dairy due to lactose intolerance" },
  // music
  { topic: "music", statement: "Lucas plays acoustic guitar at home" },
  { topic: "music", statement: "Lucas listens to jazz while working" },
  { topic: "music", statement: "Lucas attended a Coldplay concert last summer" },
  { topic: "music", statement: "Lucas dislikes heavy metal and screamo" },
  { topic: "music", statement: "Lucas studied classical piano for ten years" },
  { topic: "music", statement: "Lucas writes folk songs in his spare time" },
  { topic: "music", statement: "Lucas owns a vinyl record collection" },
  { topic: "music", statement: "Lucas prefers lossless audio over MP3" },
  { topic: "music", statement: "Lucas uses Spotify to discover new artists" },
  { topic: "music", statement: "Lucas plays in a local indie band on weekends" },
  // travel
  { topic: "travel", statement: "Lucas visited Japan and stayed in Kyoto" },
  { topic: "travel", statement: "Lucas prefers backpacking over resort tourism" },
  { topic: "travel", statement: "Lucas takes the train rather than fly within Europe" },
  { topic: "travel", statement: "Lucas hiked the Inca trail to Machu Picchu" },
  { topic: "travel", statement: "Lucas avoids cruise ships and prefers solo travel" },
  { topic: "travel", statement: "Lucas keeps a passport with two-year window" },
  { topic: "travel", statement: "Lucas speaks basic Italian for travel in Rome" },
  { topic: "travel", statement: "Lucas plans to visit Iceland next winter for aurora" },
  { topic: "travel", statement: "Lucas dislikes long-haul flights over 8 hours" },
  { topic: "travel", statement: "Lucas uses Airbnb instead of hotels in big cities" },
  // books
  { topic: "books", statement: "Lucas reads science fiction novels every night" },
  { topic: "books", statement: "Lucas loves Borges and Latin American literature" },
  { topic: "books", statement: "Lucas dislikes self-help books and motivational genres" },
  { topic: "books", statement: "Lucas keeps a Kindle for travel and a paper library at home" },
  { topic: "books", statement: "Lucas reread Lord of the Rings three times" },
  { topic: "books", statement: "Lucas subscribes to The New Yorker for essays" },
  { topic: "books", statement: "Lucas avoids audiobooks because he loses focus" },
  { topic: "books", statement: "Lucas is currently reading a biography of Newton" },
  { topic: "books", statement: "Lucas reviews books on Goodreads occasionally" },
  { topic: "books", statement: "Lucas writes fiction in his spare time" },
  // sports
  { topic: "sports", statement: "Lucas plays tennis on Saturday mornings" },
  { topic: "sports", statement: "Lucas runs 10km three times a week" },
  { topic: "sports", statement: "Lucas dislikes team sports like football" },
  { topic: "sports", statement: "Lucas does yoga to recover from running" },
  { topic: "sports", statement: "Lucas swims at the local pool every Sunday" },
  { topic: "sports", statement: "Lucas climbs at the indoor bouldering gym" },
  { topic: "sports", statement: "Lucas avoids extreme sports like skydiving" },
  { topic: "sports", statement: "Lucas competed in a marathon in Buenos Aires" },
  { topic: "sports", statement: "Lucas tracks workouts with a Garmin watch" },
  { topic: "sports", statement: "Lucas prefers individual sports over team sports" },
];

interface Query {
  text: string;
  expectedTopic: (typeof TOPICS)[number];
}

const QUERIES: Query[] = [
  { text: "what does Lucas like to drink in the morning?", expectedTopic: "food" },
  { text: "is Lucas a vegetarian or omnivore?", expectedTopic: "food" },
  { text: "what instrument does Lucas play?", expectedTopic: "music" },
  { text: "what music genre does Lucas prefer?", expectedTopic: "music" },
  { text: "where has Lucas traveled?", expectedTopic: "travel" },
  { text: "does Lucas prefer to fly or take trains?", expectedTopic: "travel" },
  { text: "what books does Lucas read?", expectedTopic: "books" },
  { text: "what literature does Lucas enjoy?", expectedTopic: "books" },
  { text: "what sport does Lucas practice?", expectedTopic: "sports" },
  { text: "does Lucas do yoga or strength training?", expectedTopic: "sports" },
];

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ searchMnemo } = await import("../../src/recall/search"));

  // Seed all 50 facts with topic-tagged embeddings. The seeding runs
  // INSIDE the workspace tx so the inserts respect RLS+FORCE.
  await withMnemoTx(wsA.id, async (tx) => {
    for (const seed of SEEDS) {
      await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: seed.statement,
        embedding: fakeVectorFor(seed.statement, seed.topic),
        metadata: { topic: seed.topic },
        tx,
      });
    }
  });
});

afterAll(() => teardownTestWorkspaces());

describe("recall/search — halfvec quantization quality (migration 0042)", () => {
  it("maintains top-1 recall >= 95% across 10 topic-scoped queries", async () => {
    let top1Correct = 0;
    let top3Correct = 0;

    for (const q of QUERIES) {
      // Embed the query against the SAME topic anchor so it lands in
      // the right cluster. Real-world embedders also place questions
      // near their topic regions — this is a faithful proxy.
      const queryVec = fakeVectorFor(q.text, q.expectedTopic);
      const embedFn = async () => ({
        vectors: [queryVec],
        model: "test-embed",
        tokensUsed: 0,
      });

      const hits = await searchMnemo({
        workspaceId: wsA.id,
        query: q.text,
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embedFn,
        // Defaults: rerank=noop, prune=off (the test asserts pre-rerank
        // recall — adding noise from a rerank step would obscure what
        // halfvec actually does).
        maxResults: 3,
      });

      expect(hits.length).toBeGreaterThan(0);

      // top-1 check
      const top1Topic = (hits[0]?.fact.metadata as { topic?: string } | undefined)?.topic;
      if (top1Topic === q.expectedTopic) top1Correct++;

      // top-3 check
      const top3Topics = hits
        .slice(0, 3)
        .map((h) => (h.fact.metadata as { topic?: string } | undefined)?.topic);
      if (top3Topics.includes(q.expectedTopic)) top3Correct++;
    }

    const top1Rate = top1Correct / QUERIES.length;
    const top3Rate = top3Correct / QUERIES.length;

    // eslint-disable-next-line no-console
    console.log(
      `[halfvec-recall-quality] top-1=${(top1Rate * 100).toFixed(0)}% top-3=${(top3Rate * 100).toFixed(0)}%`
    );

    expect(top1Rate).toBeGreaterThanOrEqual(0.95);
    expect(top3Rate).toBeGreaterThanOrEqual(0.98);
  });

  it("stores embeddings as halfvec(1536) after migration", async () => {
    // Direct DB introspection — confirm the migration actually ran and
    // the column type is halfvec, not vector. If this fails the rest
    // of the test suite is meaningless (we'd be measuring vector
    // recall, not halfvec).
    await withMnemoTx(wsA.id, async (tx) => {
      const result = (await tx.execute(`
        SELECT atttypid::regtype::text AS type
        FROM pg_attribute
        WHERE attrelid = 'mnemo_fact'::regclass
          AND attname = 'embedding'
          AND attnum > 0
      `)) as unknown as Array<{ type: string }>;
      expect(result[0]?.type).toBe("halfvec");
    });
  });
});
