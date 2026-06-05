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
import { schema } from "@orchester/db";
import { redactSecrets } from "../redact";
import type { ExporterDb } from "./workspace";

export async function exportKnowledge(workspaceId: string, db: ExporterDb) {
  // Sequential awaits (no Promise.all): when `db` is a shared
  // transaction handle, parallel queries collide on the single
  // postgres-js connection. See the matching note in `agents.ts`.
  const bases = await db
    .select()
    .from(schema.knowledgeBases)
    .where(eq(schema.knowledgeBases.workspaceId, workspaceId));
  const docs = await db
    .select()
    .from(schema.knowledgeDocs)
    .where(eq(schema.knowledgeDocs.workspaceId, workspaceId));
  const chunks = await db
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
    .where(eq(schema.knowledgeChunks.workspaceId, workspaceId));

  // Phase F.3 (2026-05-26): scrub free-form text + metadata across all
  // three tables. Chunk `text` is user content (the body of the doc),
  // but operators frequently paste config snippets, API keys, or
  // example payloads into knowledge bases without realising those go
  // out in GDPR exports verbatim. Defence in depth — false positives
  // are acceptable here (the requester gets `<REDACTED>` instead of
  // their sample key; clarification is one email away).
  return {
    bases: bases.map((b) => redactSecrets(b) as typeof b),
    docs: docs.map((d) => redactSecrets(d) as typeof d),
    chunks: chunks.map((c) => redactSecrets(c) as typeof c),
  };
}
