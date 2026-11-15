import { it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";

let wsA: WsFixture;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ getDb, schema } = await import("@orchester/db"));
}, 60_000);
afterAll(teardownTestWorkspaces);

it("updateKnowledgeBase accepts embeddingModel/embeddingProvider for a KB with no chunks", async () => {
  const db = getDb();
  const kbId = createId();
  await db.insert(schema.knowledgeBases).values({
    id: kbId,
    workspaceId: wsA.id,
    name: "kb-embed-test",
    embeddingModel: "text-embedding-3-small",
    embeddingProvider: "openai",
  });
  const { updateKnowledgeBase } = await import("@/lib/knowledge/kb-store");
  await updateKnowledgeBase(wsA.id, kbId, {
    embeddingProvider: "google",
    embeddingModel: "text-embedding-004",
  });
  const rows = await db
    .select()
    .from(schema.knowledgeBases)
    .where(eq(schema.knowledgeBases.id, kbId))
    .limit(1);
  const row = rows[0]!;
  expect(row.embeddingProvider).toBe("google");
  expect(row.embeddingModel).toBe("text-embedding-004");
});

it("updateKnowledgeBase throws when KB has existing chunks", async () => {
  const db = getDb();
  const kbId = createId();
  const docId = createId();
  await db.insert(schema.knowledgeBases).values({
    id: kbId,
    workspaceId: wsA.id,
    name: "kb-with-chunks",
    embeddingModel: "text-embedding-3-small",
    embeddingProvider: "openai",
  });
  await db.insert(schema.knowledgeDocs).values({
    id: docId,
    kbId,
    workspaceId: wsA.id,
    title: "doc",
    source: "text",
    contentType: "text/plain",
    status: "ready",
  });
  await db.insert(schema.knowledgeChunks).values({
    id: createId(),
    docId,
    kbId,
    workspaceId: wsA.id,
    ordinal: 0,
    text: "hello",
    embedding: new Array(1536).fill(0),
  });
  const { updateKnowledgeBase } = await import("@/lib/knowledge/kb-store");
  await expect(
    updateKnowledgeBase(wsA.id, kbId, {
      embeddingProvider: "google",
      embeddingModel: "text-embedding-004",
    })
  ).rejects.toThrow(/re-index/i);
});
