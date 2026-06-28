import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { extractTextFromBuffer, isParsable } from "@/lib/chunking";

const ingestJsonSchema = z.object({
  title: z.string().optional(),
  source: z.enum(["text", "url", "file"]),
  content: z.string().optional(),
  url: z.string().optional(),
  contentType: z.string().optional(),
  binaryBase64: z.string().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      return tx
        .select()
        .from(schema.knowledgeDocs)
        .where(
          and(
            eq(schema.knowledgeDocs.kbId, id),
            eq(schema.knowledgeDocs.workspaceId, ctx.workspace.id)
          )
        )
        .orderBy(desc(schema.knowledgeDocs.createdAt));
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
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
    const parsed = await parseBody(req, ingestJsonSchema);
    if (!parsed.ok) return parsed.response;
    payload = { ...parsed.data, title: parsed.data.title ?? "" } as IngestPayload;
    if (payload.source === "file" && payload.binaryBase64) {
      fileBuffer = Buffer.from(payload.binaryBase64, "base64");
      detectedFileType = payload.contentType ?? null;
    }
  }

  const MAX = Number(process.env.KB_MAX_DOC_BYTES ?? 10_000_000);
  if ((fileBuffer?.length ?? payload.content?.length ?? 0) > MAX)
    return NextResponse.json({ error: "Document too large" }, { status: 413 });

  if (!payload.title?.trim())
    return NextResponse.json({ error: "title required" }, { status: 400 });
  if (!["text", "url", "file"].includes(payload.source))
    return NextResponse.json({ error: "source must be 'text', 'url' or 'file'" }, { status: 400 });

  // Auth + initial KB lookup + doc row creation inside requireAction.
  // The long embedding pipeline runs after (uses getDb() for status updates).
  const authResult = await requireAction({
    minRole: "editor",
    run: async ({ ctx, tx }) => {
      const kbRows = await tx
        .select()
        .from(schema.knowledgeBases)
        .where(
          and(
            eq(schema.knowledgeBases.id, kbId),
            eq(schema.knowledgeBases.workspaceId, ctx.workspace.id)
          )
        )
        .limit(1);
      const kb = kbRows[0];
      if (!kb) return { _err: "Knowledge base not found", _status: 404 };

      const docId = createId();
      const initialContentType = detectedFileType ?? payload.contentType ?? "text/plain";
      await tx.insert(schema.knowledgeDocs).values({
        id: docId,
        kbId,
        workspaceId: ctx.workspace.id,
        title: payload.title.trim(),
        source: payload.source,
        url: payload.url ?? null,
        contentType: initialContentType,
        byteSize: fileBuffer?.length ?? payload.content?.length ?? 0,
        status: "parsing",
      });
      return { docId };
    },
  });
  if (authResult instanceof Response) return authResult;
  if ("_err" in authResult)
    return NextResponse.json({ error: authResult._err }, { status: authResult._status as number });

  const { docId } = authResult;

  // Text extraction + enqueue (or inline dev mode).
  // Status transitions (embedding → ready/failed) are handled by ingestDoc.
  const db = getDb();
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
      if (upstreamCT.startsWith("application/pdf") || upstreamCT.includes("officedocument")) {
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

    if (process.env.KB_INGEST_INLINE === "1") {
      const { ingestDoc } = await import("@/lib/knowledge/ingest");
      await ingestDoc(docId, text);
      return NextResponse.json({ id: docId, status: "ready" }, { status: 201 });
    }
    const { enqueue, JOB_KB_INGEST } = await import("@/lib/queue");
    await enqueue(JOB_KB_INGEST, { docId, rawText: text }, { retryLimit: 3, retryBackoff: true });
    return NextResponse.json({ id: docId, status: "parsing" }, { status: 202 });
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
