import { describe, it, expect } from "vitest";
import archiver from "archiver";
import { assertZipBounded } from "@/lib/integrations/attachment-table";
import { extractTextFromBuffer } from "@/lib/chunking";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function zip(entries: Record<string, string | Buffer>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const a = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    a.on("data", (c: Buffer) => chunks.push(c));
    a.on("end", () => resolve(Buffer.concat(chunks)));
    a.on("error", reject);
    for (const [name, body] of Object.entries(entries)) a.append(body, { name });
    void a.finalize();
  });
}

const docxParts = (body: string) => ({
  "[Content_Types].xml":
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "_rels/.rels":
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:body></w:document>`,
});

describe("docx zip bomb guard", () => {
  it("still reads a normal docx", async () => {
    const buf = await zip(docxParts("Hola mundo"));
    expect(() => assertZipBounded(buf)).not.toThrow();
    expect(await extractTextFromBuffer(buf, DOCX)).toContain("Hola mundo");
  });

  it("refuses an archive that inflates past the cap before mammoth sees it", async () => {
    const bomb = await zip({
      ...docxParts("x"),
      "word/media/padding.bin": Buffer.alloc(30 * 1024 * 1024),
      "word/media/padding2.bin": Buffer.alloc(30 * 1024 * 1024),
    });
    expect(bomb.length).toBeLessThan(200 * 1024);
    expect(() => assertZipBounded(bomb)).toThrow(/too large/);
    await expect(extractTextFromBuffer(bomb, DOCX)).rejects.toThrow(/too large/);
  });
});
