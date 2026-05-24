// apps/web/lib/gdpr/exporters/knowledge.ts
//
// Dump every knowledge_base, knowledge_doc, and knowledge_chunk row
// for the workspace.
//
// Embeddings are deliberately stripped from chunks: they're a derived
// representation (rebuildable from `text`), would inflate the archive
// 10-100x for no user value, and accidentally re-importing them
// elsewhere would defeat the embedding-model abstraction we ship.
import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import type { ExporterDb } from "./workspace";

export async function exportKnowledge(workspaceId: string, db?: ExporterDb) {
  const client = db ?? getDb();

  const [bases, docs, chunks] = await Promise.all([
    client
      .select()
      .from(schema.knowledgeBases)
      .where(eq(schema.knowledgeBases.workspaceId, workspaceId)),
    client
      .select()
      .from(schema.knowledgeDocs)
      .where(eq(schema.knowledgeDocs.workspaceId, workspaceId)),
    client
      .select({
        id: schema.knowledgeChunks.id,
        docId: schema.knowledgeChunks.docId,
        kbId: schema.knowledgeChunks.kbId,
        workspaceId: schema.knowledgeChunks.workspaceId,
        ordinal: schema.knowledgeChunks.ordinal,
        text: schema.knowledgeChunks.text,
        metadata: schema.knowledgeChunks.metadata,
        createdAt: schema.knowledgeChunks.createdAt,
      })
      .from(schema.knowledgeChunks)
      .where(eq(schema.knowledgeChunks.workspaceId, workspaceId)),
  ]);

  return { bases, docs, chunks };
}
