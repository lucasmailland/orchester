import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { embed } from "@/lib/embeddings";
import { chunkText, extractTextFromBuffer, isParsable } from "@/lib/chunking";

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

interface IngestPayload {
  title: string;
  source: "text" | "url" | "file";
  content?: string;
  url?: string;
  contentType?: string;
  /** For source="file" — base64 (used by JSON clients) or multipart upload. */
  binaryBase64?: string;
}

/**
 * POST — Ingest a document.
 *
 * Two content-type paths:
 *   1) application/json — { title, source: "text"|"url"|"file", content?, url?, binaryBase64?, contentType? }
 *   2) multipart/form-data — fields: title, source="file", file=<binary>
 *
 * Pipeline (synchronous):
 *   parse → chunk → embed → persist → ready.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: kbId } = await params;
  const reqContentType = req.headers.get("content-type") ?? "";

  let payload: IngestPayload;
  let fileBuffer: Buffer | null = null;
  let detectedFileType: string | null = null;

  if (reqContentType.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file field required" }, { status: 400 });
    }
    fileBuffer = Buffer.from(await file.arrayBuffer());
    detectedFileType = file.type || guessTypeFromName(file.name);
    payload = {
      title: String(form.get("title") ?? file.name),
      source: "file",
      contentType: detectedFileType,
    };
  } else {
    payload = (await req.json()) as IngestPayload;
    if (payload.source === "file" && payload.binaryBase64) {
      fileBuffer = Buffer.from(payload.binaryBase64, "base64");
      detectedFileType = payload.contentType ?? null;
    }
  }

  if (!payload.title?.trim())
    return NextResponse.json({ error: "title required" }, { status: 400 });
  if (!["text", "url", "file"].includes(payload.source))
    return NextResponse.json(
      { error: "source must be 'text', 'url' or 'file'" },
      { status: 400 }
    );

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
  if (!kb)
    return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 });

  const docId = createId();
  const initialContentType =
    detectedFileType ?? payload.contentType ?? "text/plain";
  await db.insert(schema.knowledgeDocs).values({
    id: docId,
    kbId,
    workspaceId: ws.workspace.id,
    title: payload.title.trim(),
    source: payload.source,
    url: payload.url ?? null,
    contentType: initialContentType,
    byteSize: fileBuffer?.length ?? payload.content?.length ?? 0,
    status: "parsing",
  });

  try {
    let text = "";

    if (payload.source === "text") {
      text = payload.content ?? "";
    } else if (payload.source === "url" && payload.url) {
      const r = await fetch(payload.url, {
        headers: { "user-agent": "Orchester KB Ingest/1.0" },
      });
      if (!r.ok) throw new Error(`URL returned ${r.status}`);
      const upstreamCT = r.headers.get("content-type") ?? "";
      if (
        upstreamCT.startsWith("application/pdf") ||
        upstreamCT.includes("officedocument")
      ) {
        const buf = Buffer.from(await r.arrayBuffer());
        text = await extractTextFromBuffer(buf, upstreamCT.split(";")[0]!);
      } else {
        const raw = await r.text();
        text = raw
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    } else if (payload.source === "file" && fileBuffer) {
      const ct = detectedFileType ?? "application/octet-stream";
      if (!isParsable(ct)) {
        throw new Error(`Content type ${ct} not supported.`);
      }
      text = await extractTextFromBuffer(fileBuffer, ct);
    }

    if (!text || !text.trim()) throw new Error("Empty document content");

    const chunks = chunkText(text, kb.chunkSize, kb.chunkOverlap);
    if (chunks.length === 0) throw new Error("No chunks produced");

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

    const chunkRows = chunks.map((c, i) => ({
      id: createId(),
      docId,
      kbId,
      workspaceId: ws.workspace.id,
      ordinal: i,
      text: c,
      embedding: vectors[i] ?? null,
    }));
    if (chunkRows.length > 0) {
      await db.insert(schema.knowledgeChunks).values(chunkRows);
    }

    await db
      .update(schema.knowledgeDocs)
      .set({ status: "ready", chunkCount: chunks.length })
      .where(eq(schema.knowledgeDocs.id, docId));

    return NextResponse.json(
      { id: docId, chunkCount: chunks.length, status: "ready" },
      { status: 201 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.knowledgeDocs)
      .set({ status: "failed", error: msg })
      .where(eq(schema.knowledgeDocs.id, docId));
    return NextResponse.json({ error: msg, docId }, { status: 500 });
  }
}

function guessTypeFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (n.endsWith(".md")) return "application/x-markdown";
  if (n.endsWith(".json")) return "application/json";
  if (n.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}
