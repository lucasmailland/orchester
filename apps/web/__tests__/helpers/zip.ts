import { deflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Buffer;
  /** 8 = deflate (default), 0 = stored, anything else is written as-is. */
  method?: number;
  flags?: number;
  /** Lie about the uncompressed size in the central directory. */
  declaredSize?: number;
  /** Write the raw bytes as the payload instead of compressing `data`. */
  raw?: Buffer;
}

/** Minimal ZIP writer for tests: local headers, central directory, EOCD. */
export function buildZip(entries: ZipEntry[], opts: { zip64Marker?: boolean } = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const payload = e.raw ?? (method === 8 ? deflateRawSync(e.data) : e.data);
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(e.declaredSize ?? e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, payload);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(e.flags ?? 0, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(payload.length, 20);
    c.writeUInt32LE(e.declaredSize ?? e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + payload.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(opts.zip64Marker ? 0xffff : entries.length, 8);
  eocd.writeUInt16LE(opts.zip64Marker ? 0xffff : entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A tiny but structurally real xlsx: shared strings, inline strings, numbers, booleans. */
export function buildXlsx(opts: { rows?: number } = {}): Buffer {
  const extra = opts.rows ?? 0;
  const shared = ["Name", "Hours", "Note", "Ana & Co", "mail ana@example.com"];
  let rows =
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>` +
    `<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>8.5</v></c><c r="C2" t="inlineStr"><is><t>DNI 12.345.678</t></is></c></row>` +
    `<row r="3"><c r="A3" t="s"><v>4</v></c><c r="C3" t="b"><v>1</v></c></row>`;
  for (let i = 0; i < extra; i++)
    rows += `<row r="${i + 4}"><c r="A${i + 4}"><v>${i}</v></c></row>`;
  const xml = (s: string) => Buffer.from(`<?xml version="1.0"?>${s}`);
  return buildZip([
    { name: "[Content_Types].xml", data: xml("<Types/>") },
    {
      name: "xl/workbook.xml",
      data: xml(
        `<workbook><sheets><sheet name="Horas" sheetId="1" r:id="rId7"/></sheets></workbook>`
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: xml(
        `<Relationships><Relationship Id="rId7" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
      ),
    },
    {
      name: "xl/sharedStrings.xml",
      data: xml(`<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: xml(`<worksheet><sheetData>${rows}</sheetData></worksheet>`),
    },
  ]);
}
