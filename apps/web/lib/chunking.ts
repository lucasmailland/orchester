/**
 * Simple text chunker — splits on paragraph then sentence boundaries,
 * accumulating until `chunkSize` is reached. Overlaps last `chunkOverlap`
 * chars between chunks for context continuity.
 */
export function chunkText(
  text: string,
  chunkSize = 800,
  chunkOverlap = 100
): string[] {
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

/**
 * Convert various input types to plain text. PDF/DOCX support deliberately
 * deferred — for v1 we accept text, markdown, and pre-parsed payloads.
 * If a PDF arrives we just store it without parsing and mark the doc as failed.
 */
export function isParsable(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/x-markdown"
  );
}
