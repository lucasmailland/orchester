import { it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import { eq } from "drizzle-orm";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

// Mock embed at the embeddings module level so the spy intercepts across modules.
const { mockEmbedFn } = vi.hoisted(() => ({
  mockEmbedFn: vi.fn(),
}));
vi.mock("@/lib/embeddings", async (orig) => {
  const real = await orig();
  return { ...(real as object), embed: mockEmbedFn };
});

let wsA: WsFixture;
let ingest: typeof import("@/lib/knowledge/ingest");
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ingest = await import("@/lib/knowledge/ingest");
  ({ getDb, schema } = await import("@orchester/db"));
}, 60_000);
afterAll(() => teardownTestWorkspaces());

async function seedKbDoc(text: string) {
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
    title: "d",
    source: "text",
    status: "parsing",
    contentType: "text/plain",
    byteSize: text.length,
  });
  return { kbId, docId };
}

it("ingestDoc embeds chunks and marks the doc ready with non-null embeddings", async () => {
  mockEmbedFn.mockImplementation(async (_ws: string, _p: string, _m: string, chunks: string[]) => ({
    vectors: chunks.map(() => new Array(1536).fill(0.01)),
    dims: 1536,
    model: "text-embedding-3-small",
  }));
  const { kbId, docId } = await seedKbDoc("Sentence one. Sentence two. Sentence three.");
  await ingest.ingestDoc(docId, "Sentence one. Sentence two. Sentence three.");
  const db = getDb();
  const doc = (
    await db.select().from(schema.knowledgeDocs).where(eq(schema.knowledgeDocs.id, docId)).limit(1)
  )[0]!;
  expect(doc.status).toBe("ready");
  const chunks = await db
    .select()
    .from(schema.knowledgeChunks)
    .where(eq(schema.knowledgeChunks.kbId, kbId));
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks.every((c) => c.embedding != null)).toBe(true);
});

it("marks the doc FAILED (never ready) when an embedding is missing", async () => {
  // Return fewer vectors than chunks to reliably trigger the null-vector guard.
  mockEmbedFn.mockImplementation(async () => ({
    vectors: [] as number[][],
    dims: 1536,
    model: "text-embedding-3-small",
  }));
  const { docId } = await seedKbDoc("A. B.");
  await expect(ingest.ingestDoc(docId, "A. B.")).rejects.toThrow(/embedding/i);
  const db = getDb();
  const doc = (
    await db.select().from(schema.knowledgeDocs).where(eq(schema.knowledgeDocs.id, docId)).limit(1)
  )[0]!;
  expect(doc.status).toBe("failed");
});
