import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { embed } from "@/lib/embeddings";
import { chunkText, isParsable } from "@/lib/chunking";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.knowledgeDocs)
    .where(
      and(
        eq(schema.knowledgeDocs.kbId, id),
        eq(schema.knowledgeDocs.workspaceId, ws.workspace.id)
      )
    )
    .orderBy(desc(schema.knowledgeDocs.createdAt));
  return NextResponse.json(rows);
}

/**
 * POST: Ingest a document. Body: { title, source: "text"|"url", content?, url?, contentType? }
 * For "text" source, the body.content is parsed/chunked/embedded synchronously.
 * For "url" source, fetches the URL and treats it as text.
 * PDF/DOCX parsing is deferred — they'll be marked failed with a helpful error.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: kbId } = await params;
  const body = await req.json();
  const { title, source, content, url, contentType } = body as {
    title: string;
    source: "text" | "url";
    content?: string;
    url?: string;
    contentType?: string;
  };
  if (!title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });
  if (source !== "text" && source !== "url")
    return NextResponse.json({ error: "source must be 'text' or 'url'" }, { status: 400 });

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
  if (!kb) return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 });

  // 1. Create doc row
  const docId = createId();
  await db.insert(schema.knowledgeDocs).values({
    id: docId,
    kbId,
    workspaceId: ws.workspace.id,
    title: title.trim(),
    source,
    url: url ?? null,
    contentType: contentType ?? "text/plain",
    byteSize: content?.length ?? 0,
    status: "parsing",
  });

  try {
    let text = content ?? "";
    if (source === "url" && url) {
      const r = await fetch(url, { headers: { "user-agent": "Orchester KB Ingest/1.0" } });
      if (!r.ok) throw new Error(`URL returned ${r.status}`);
      text = await r.text();
      // crude HTML strip
      text = text
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    if (!text) throw new Error("Empty document content");

    const ct = contentType ?? "text/plain";
    if (!isParsable(ct) && source === "text") {
      throw new Error(
        `Content type ${ct} not supported in v1 (parser deferred). Use plain text or a URL.`
      );
    }

    const chunks = chunkText(text, kb.chunkSize, kb.chunkOverlap);
    if (chunks.length === 0) throw new Error("No chunks produced");

    // 2. Embed
    await db
      .update(schema.knowledgeDocs)
      .set({ status: "embedding" })
      .where(eq(schema.knowledgeDocs.id, docId));

    const { vectors } = await embed(
      ws.workspace.id,
      kb.embeddingProvider as "openai" | "google",
      kb.embeddingModel,
      chunks
    );

    // 3. Persist chunks
    const chunkRows = chunks.map((text, i) => ({
      id: createId(),
      docId,
      kbId,
      workspaceId: ws.workspace.id,
      ordinal: i,
      text,
      embedding: vectors[i] ?? null,
    }));
    if (chunkRows.length > 0) {
      await db.insert(schema.knowledgeChunks).values(chunkRows);
    }

    await db
      .update(schema.knowledgeDocs)
      .set({ status: "ready", chunkCount: chunks.length })
      .where(eq(schema.knowledgeDocs.id, docId));

    return NextResponse.json({ id: docId, chunkCount: chunks.length, status: "ready" }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.knowledgeDocs)
      .set({ status: "failed", error: msg })
      .where(eq(schema.knowledgeDocs.id, docId));
    return NextResponse.json({ error: msg, docId }, { status: 500 });
  }
}
