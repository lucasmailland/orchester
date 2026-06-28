/**
 * Simple text chunker — splits on paragraph then sentence boundaries,
 * accumulating until `chunkSize` is reached. Overlaps last `chunkOverlap`
 * chars between chunks for context continuity.
 */
export function chunkText(text: string, chunkSize = 800, chunkOverlap = 100): string[] {
  if (!text.trim()) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+|\n\n+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buffer = "";

  for (const s of sentences) {
    if (s.length > chunkSize) {
      // Sentence too long — break by char window
      if (buffer) {
        chunks.push(buffer);
        buffer = buffer.slice(-chunkOverlap);
      }
      let i = 0;
      while (i < s.length) {
        const slice = s.slice(i, i + chunkSize);
        chunks.push(slice);
        i += chunkSize - chunkOverlap;
      }
      continue;
    }
    if ((buffer + " " + s).length > chunkSize) {
      chunks.push(buffer);
      buffer = buffer.slice(-chunkOverlap) + " " + s;
    } else {
      buffer = buffer ? buffer + " " + s : s;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks.map((c) => c.trim()).filter(Boolean);
}

/** Chunk with heading metadata for RAG citations (KNOW-8).
 *  Detects markdown headings (#/##/…) and attaches the nearest preceding one. */
export function chunkTextWithMeta(
  text: string,
  chunkSize = 800,
  chunkOverlap = 100
): { text: string; heading?: string }[] {
  const lines = text.split("\n");
  let currentHeading: string | undefined;
  let segmentText = "";
  const result: { text: string; heading?: string }[] = [];

  function flushSegment() {
    if (!segmentText.trim()) return;
    for (const c of chunkText(segmentText, chunkSize, chunkOverlap)) {
      result.push({ text: c, ...(currentHeading ? { heading: currentHeading } : {}) });
    }
    segmentText = "";
  }

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      flushSegment();
      currentHeading = headingMatch[1]!.trim();
    } else {
      segmentText += (segmentText ? "\n" : "") + line;
    }
  }
  flushSegment();
  return result;
}

/**
 * Convert various input types to plain text. Supports text/*, JSON, markdown,
 * PDF and DOCX. Anything else is rejected with a helpful error.
 */
export function isParsable(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/x-markdown" ||
    contentType === "application/pdf" ||
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

/**
 * Extract plain text from a buffer based on the content type.
 * Throws on unsupported types.
 */
export async function extractTextFromBuffer(buffer: Buffer, contentType: string): Promise<string> {
  if (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/x-markdown"
  ) {
    return buffer.toString("utf-8");
  }
  if (contentType === "application/pdf") {
    const mod = (await import("pdf-parse")) as unknown as {
      default: (buf: Buffer) => Promise<{ text: string }>;
    };
    const parsed = await mod.default(buffer);
    return parsed.text ?? "";
  }
  if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const mod = (await import("mammoth")) as unknown as {
      extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
    };
    const result = await mod.extractRawText({ buffer });
    return result.value ?? "";
  }
  throw new Error(`Unsupported content type for ingest: ${contentType}`);
}
