import "server-only";
import { getDb, schema, type DbClient } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";
import { embed } from "./embeddings";

/**
 * Optional `tx?: WsDb` follows the project-wide pattern (see
 * `lib/billing/quotas.ts`). When the caller is already inside a
 * workspace transaction (channels router, flow engine), pass `tx` so
 * the kb lookup + raw vector query run on the same connection that
 * has `app.workspace_id` SET LOCAL — otherwise FORCE RLS rejects the
 * read.
 */
type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export interface KnowledgeHit {
  id: string;
  docId: string;
  ordinal: number;
  text: string;
  docTitle: string;
  score: number;
}

/**
 * Semantic search over a knowledge base (pgvector cosine). Single source of
 * truth reused by the agent tool, the flow engine and the API route.
 */
export async function searchKnowledgeBase(
  workspaceId: string,
  kbId: string,
  query: string,
  topK = 5,
  tx?: WsDb
): Promise<KnowledgeHit[]> {
  if (!kbId || !query.trim()) return [];
  const limit = Math.min(20, Math.max(1, Number(topK) || 5));
  const db = tx ?? getDb();
  const kbs = await db
    .select()
    .from(schema.knowledgeBases)
    .where(
      and(eq(schema.knowledgeBases.id, kbId), eq(schema.knowledgeBases.workspaceId, workspaceId))
    )
    .limit(1);
  const kb = kbs[0];
  if (!kb) throw new Error(`No encontramos la base de conocimiento (${kbId}).`);

  const { vectors } = await embed(
    workspaceId,
    kb.embeddingProvider as "openai" | "google",
    kb.embeddingModel,
    [query],
    tx
  );
  const v = vectors[0];
  if (!v) return [];
  const vec = `[${v.join(",")}]`;
  const rows = await db.execute(sql`
    select c.id, c.doc_id as "docId", c.ordinal, c.text,
           d.title as "docTitle",
           1 - (c.embedding <=> ${vec}::vector) as score
    from knowledge_chunk c
    inner join knowledge_doc d on d.id = c.doc_id
    where c.workspace_id = ${workspaceId}
      and c.kb_id = ${kbId}
      and c.embedding is not null
    order by c.embedding <=> ${vec}::vector
    limit ${limit}
  `);
  return rows as unknown as KnowledgeHit[];
}
