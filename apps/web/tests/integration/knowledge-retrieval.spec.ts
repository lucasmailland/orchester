import { it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let wsA: WsFixture;
let search: typeof import("@/lib/knowledge-search");
let chunking: typeof import("@/lib/chunking");
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  search = await import("@/lib/knowledge-search");
  chunking = await import("@/lib/chunking");
  ({ getDb, schema } = await import("@orchester/db"));
}, 60_000);
afterAll(() => teardownTestWorkspaces());

it("chunkTextWithMeta attaches the nearest preceding markdown heading", () => {
  const out = chunking.chunkTextWithMeta(
    "# Pricing\nWe charge 10 USD per seat. It is a fair price for teams.",
    80,
    10
  );
  expect(out[0]).toMatchObject({ heading: "Pricing" });
});

it("falls back to FTS lexical search when vector hits are below the score threshold", async () => {
  const db = getDb();
  const kbId = createId();
  const docId = createId();
  await db.insert(schema.knowledgeBases).values({
    id: kbId,
    workspaceId: wsA.id,
    name: "kb",
    embeddingModel: "text-embedding-3-small",
    embeddingProvider: "openai",
  });
  await db.insert(schema.knowledgeDocs).values({
    id: docId,
    kbId,
    workspaceId: wsA.id,
    title: "Handbook",
    status: "ready",
  });
  await db.insert(schema.knowledgeChunks).values({
    id: createId(),
    docId,
    kbId,
    workspaceId: wsA.id,
    ordinal: 0,
    text: "The vacation policy grants 15 days per year.",
    // orthogonal → cosine ~0 → below threshold
    embedding: new Array(1536).fill(0),
    metadata: {
      dims: 1536,
      embeddingModel: "text-embedding-3-small",
      heading: "Vacation",
    },
  });
  // Stub query embedding to a zero/near-zero vector so vector hits are below threshold.
  vi.spyOn(await import("@/lib/embeddings"), "embed").mockResolvedValue({
    vectors: [new Array(1536).fill(0)],
    dims: 1536,
    model: "text-embedding-3-small",
    tokensUsed: 0,
  } as never);
  const hits = await search.searchKnowledgeBase(wsA.id, kbId, "vacation policy", 5);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0]!.text).toMatch(/vacation policy/i);
  expect(hits[0]).toHaveProperty("heading", "Vacation");
});
