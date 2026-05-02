import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { embed } from "@/lib/embeddings";

/**
 * POST /api/knowledge-bases/[id]/search
 * Body: { query: string, topK?: number }
 * Uses pgvector cosine distance (<=>); returns chunks with score = 1 - distance.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: kbId } = await params;
  const body = await req.json();
  const query = String(body?.query ?? "").trim();
  const topK = Math.min(20, Number(body?.topK ?? 5));
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });

  const db = getDb();
  const kbRows = await db
    .select()
    .from(schema.knowledgeBases)
    .where(
      and(
        eq(schema.knowledgeBases.id, kbId),
        eq(schema.knowledgeBases.workspaceId, ws.workspace.id)
      )
    )
    .limit(1);
  const kb = kbRows[0];
  if (!kb) return NextResponse.json({ error: "KB not found" }, { status: 404 });

  const { vectors } = await embed(
    ws.workspace.id,
    kb.embeddingProvider as "openai" | "google",
    kb.embeddingModel,
    [query]
  );
  const v = vectors[0];
  if (!v) return NextResponse.json({ results: [] });
  const vec = `[${v.join(",")}]`;

  // pgvector <=> is cosine distance; ORDER BY ascending = most similar first
  const rows = await db.execute(sql`
    select c.id, c.doc_id as "docId", c.ordinal, c.text,
           d.title as "docTitle",
           1 - (c.embedding <=> ${vec}::vector) as score
    from knowledge_chunk c
    inner join knowledge_doc d on d.id = c.doc_id
    where c.workspace_id = ${ws.workspace.id}
      and c.kb_id = ${kbId}
      and c.embedding is not null
    order by c.embedding <=> ${vec}::vector
    limit ${topK}
  `);

  return NextResponse.json({ results: rows });
}
