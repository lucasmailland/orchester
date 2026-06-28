import "server-only";
import { getDb, schema } from "@orchester/db";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { chunkText } from "../chunking";
import { embed } from "../embeddings";

export async function embedChunks(
  workspaceId: string,
  kb: { embeddingProvider: string; embeddingModel: string },
  chunks: string[]
) {
  return embed(workspaceId, kb.embeddingProvider as "openai" | "google", kb.embeddingModel, chunks);
}

/** Parse→chunk→embed→insert pipeline. Never marks a doc `ready` with a null
 *  embedding (KNOW-4). Throws on any failure after setting status=failed. */
export async function ingestDoc(docId: string, rawText: string): Promise<void> {
  const db = getDb();
  const docRows = await db
    .select()
    .from(schema.knowledgeDocs)
    .where(eq(schema.knowledgeDocs.id, docId))
    .limit(1);
  const doc = docRows[0];
  if (!doc) throw new Error(`doc ${docId} not found`);
  try {
    const kb = (
      await db
        .select()
        .from(schema.knowledgeBases)
        .where(eq(schema.knowledgeBases.id, doc.kbId))
        .limit(1)
    )[0];
    if (!kb) throw new Error("kb not found");
    if (!rawText.trim()) throw new Error("Empty document content");
    const chunks = chunkText(rawText, kb.chunkSize, kb.chunkOverlap);
    if (chunks.length === 0) throw new Error("No chunks produced");
    await db
      .update(schema.knowledgeDocs)
      .set({ status: "embedding" })
      .where(eq(schema.knowledgeDocs.id, docId));
    const { vectors, dims } = await embedChunks(doc.workspaceId, kb, chunks);
    if (vectors.length !== chunks.length || vectors.some((v) => v == null)) {
      throw new Error(
        `embedding incomplete: got ${vectors.filter(Boolean).length}/${chunks.length} vectors`
      );
    }
    const rows = chunks.map((c, i) => ({
      id: createId(),
      docId,
      kbId: doc.kbId,
      workspaceId: doc.workspaceId,
      ordinal: i,
      text: c,
      embedding: vectors[i]!,
      metadata: { dims, embeddingModel: kb.embeddingModel },
    }));
    await db.insert(schema.knowledgeChunks).values(rows);
    await db
      .update(schema.knowledgeDocs)
      .set({ status: "ready", chunkCount: chunks.length })
      .where(eq(schema.knowledgeDocs.id, docId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.knowledgeDocs)
      .set({ status: "failed", error: msg })
      .where(eq(schema.knowledgeDocs.id, docId));
    throw e;
  }
}
