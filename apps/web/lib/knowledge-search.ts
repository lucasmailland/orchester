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
  /** Nearest preceding markdown heading surfaced from chunk metadata (KNOW-8). */
  heading?: string;
  /** Page number surfaced from chunk metadata (KNOW-8). */
  page?: number;
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
  tx?: WsDb,
  /** Drop vector hits below this cosine similarity (KNOW-8). */
  minScore = 0.2,
  /** Optional JSONB @> filter on chunk metadata (KNOW-8). */
  filter?: Record<string, unknown>
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

  // KNOW-3: guard that chunks were embedded with the same model the query now
  // uses. Comparing vectors from different models produces meaningless rankings.
  const sample = await db
    .select({ metadata: schema.knowledgeChunks.metadata })
    .from(schema.knowledgeChunks)
    .where(
      and(
        eq(schema.knowledgeChunks.kbId, kbId),
        eq(schema.knowledgeChunks.workspaceId, workspaceId)
      )
    )
    .limit(1);
  const storedModel = (sample[0]?.metadata as { embeddingModel?: string } | undefined)
    ?.embeddingModel;
  if (storedModel && storedModel !== kb.embeddingModel) {
    throw new Error(
      `Embedding model mismatch: chunks embedded with "${storedModel}" but KB now uses "${kb.embeddingModel}". Re-index the knowledge base. (modelo de embedding no coincide)`
    );
  }

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
  const metaFilter = filter ? sql` and c.metadata @> ${JSON.stringify(filter)}::jsonb` : sql``;
  const rows = await db.execute(sql`
    select c.id, c.doc_id as "docId", c.ordinal, c.text,
           d.title as "docTitle", c.metadata as "metadata",
           1 - (c.embedding <=> ${vec}::vector) as score
    from knowledge_chunk c
    inner join knowledge_doc d on d.id = c.doc_id
    where c.workspace_id = ${workspaceId}
      and c.kb_id = ${kbId}
      and c.embedding is not null
      ${metaFilter}
    order by c.embedding <=> ${vec}::vector
    limit ${limit}
  `);

  // KNOW-8: project heading/page from metadata into each hit.
  function projectHit(row: Record<string, unknown>): KnowledgeHit {
    const meta = (row.metadata as { heading?: string; page?: number } | null) ?? {};
    return {
      id: row.id as string,
      docId: row.docId as string,
      ordinal: row.ordinal as number,
      text: row.text as string,
      docTitle: row.docTitle as string,
      score: Number(row.score),
      ...(meta.heading ? { heading: meta.heading } : {}),
      ...(meta.page != null ? { page: meta.page } : {}),
    };
  }

  const allHits = (rows as unknown as Record<string, unknown>[]).map(projectHit);
  const above = allHits.filter((r) => r.score >= minScore);
  if (above.length >= Math.min(2, limit)) return above.slice(0, limit);

  // Hybrid fallback: Postgres FTS lexical search (KNOW-8).
  // Lexical hits fill gaps when semantic similarity is low (different vocab, typos, etc.).
  const fts = await db.execute(sql`
    select c.id, c.doc_id as "docId", c.ordinal, c.text,
           d.title as "docTitle", c.metadata as "metadata",
           ts_rank(to_tsvector('simple', c.text), plainto_tsquery('simple', ${query})) as score
    from knowledge_chunk c
    inner join knowledge_doc d on d.id = c.doc_id
    where c.workspace_id = ${workspaceId}
      and c.kb_id = ${kbId}
      and to_tsvector('simple', c.text) @@ plainto_tsquery('simple', ${query})
    order by score desc
    limit ${limit}
  `);
  const merged = new Map<string, KnowledgeHit>();
  for (const h of [...above, ...(fts as unknown as Record<string, unknown>[]).map(projectHit)]) {
    if (!merged.has(h.id)) merged.set(h.id, h);
  }
  return Array.from(merged.values()).slice(0, limit);
}
