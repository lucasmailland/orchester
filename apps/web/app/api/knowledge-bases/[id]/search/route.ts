import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { embed } from "@/lib/embeddings";

const kbSearchSchema = z.object({
  query: z.string().optional(),
  topK: z.number().optional(),
});

/**
 * POST /api/knowledge-bases/[id]/search
 * Body: { query: string, topK?: number }
 * Uses pgvector cosine distance (<=>); returns chunks with score = 1 - distance.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (!isAuthContext(ctx)) return ctx;
  const ws = { workspace: ctx.workspace };
  const { id: kbId } = await params;
  const parsed = await parseBody(req, kbSearchSchema);
  if (!parsed.ok) return parsed.response;
  const query = String(parsed.data.query ?? "").trim();
  const topK = Math.min(20, Number(parsed.data.topK ?? 5));
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });

  const db = getDb();
  // Wrap the whole route in a single tx so the kb lookup AND the
  // raw pgvector search both run under the workspace GUC. RLS-gated
  // knowledge_base / knowledge_chunk / knowledge_doc all key on it.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ws.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    const kbRows = await tx
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
    if (!kb) return { kind: "kb_not_found" as const };

    const { vectors } = await embed(
      ws.workspace.id,
      kb.embeddingProvider as "openai" | "google",
      kb.embeddingModel,
      [query]
    );
    const v = vectors[0];
    if (!v) return { kind: "ok" as const, rows: [] as unknown[] };
    const vec = `[${v.join(",")}]`;

    // pgvector <=> is cosine distance; ORDER BY ascending = most similar first
    const rows = await tx.execute(sql`
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
    return { kind: "ok" as const, rows };
  });

  if (result.kind === "kb_not_found") {
    return NextResponse.json({ error: "KB not found" }, { status: 404 });
  }
  return NextResponse.json({ results: result.rows });
}
