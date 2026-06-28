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
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  search = await import("@/lib/knowledge-search");
  ({ getDb, schema } = await import("@orchester/db"));
}, 60_000);
afterAll(() => teardownTestWorkspaces());

it("throws a clear error when a chunk was embedded with a different model than the KB now uses", async () => {
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
    status: "ready",
  });
  await db.insert(schema.knowledgeChunks).values({
    id: createId(),
    docId,
    kbId,
    workspaceId: wsA.id,
    ordinal: 0,
    text: "hello",
    embedding: new Array(1536).fill(0.01),
    metadata: { dims: 1536, embeddingModel: "text-embedding-004" },
  });
  await expect(search.searchKnowledgeBase(wsA.id, kbId, "hello")).rejects.toThrow(
    /embedding model.*mismatch|modelo de embedding/i
  );
});
