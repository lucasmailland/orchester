/**
 * Read a CSV or XLSX attachment into a small, masked table for a model.
 *
 * No dependency on purpose: the XLSX reader is a minimal ZIP + OOXML scanner
 * with hard bounds, and nothing in the file is ever evaluated (formulas are
 * ignored, the cached value is used). The content is untrusted and personal:
 * long digit runs and e-mail addresses are masked before the caller returns it.
 */
import { inflateRawSync } from "node:zlib";

export const MAX_TABLE_FILE_BYTES = 5 * 1024 * 1024;
export const TABLE_MAX_ROWS = 50;
export const TABLE_MAX_COLUMNS = 30;
export const TABLE_CELL_CHARS = 200;

const MAX_ZIP_ENTRIES = 50;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
// Pre-mask cap so one pathological cell cannot make the regexes expensive.
const RAW_CELL_CHARS = 2000;

export interface Table {
  columns: string[];
  rows: string[][];
  total_rows: number;
  truncated: boolean;
}
export interface SheetTable extends Table {
  sheet: string;
}

// ---------------------------------------------------------------- masking

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// Alternation order matters at a given position: dates and times are consumed
// first so "2026-10-08 09:30" is not read as one 10-digit run. Anything else
// with 7+ digits (single `.`, `-` or space allowed between digits) is an
// identifier: DNI, CUIT, phone.
const NUM_OR_SAFE =
  /(\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{1,2}:\d{2}(?::\d{2})?)|\d(?:[.\- ]?\d){6,}/g;

/** Replace e-mail addresses and runs of 7+ digits; dates, times and short numbers survive. */
export function maskSensitive(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(NUM_OR_SAFE, (m, safe: string | undefined) => (safe ? m : "[num]"));
}

function cell(raw: string): string {
  return maskSensitive(raw.slice(0, RAW_CELL_CHARS).trim()).slice(0, TABLE_CELL_CHARS);
}

/** Shape matrix rows into the output table: mask, cap columns and rows. */
function shape(matrix: string[][]): Table {
  const nonEmpty = matrix.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { columns: [], rows: [], total_rows: 0, truncated: false };
  const width = Math.max(...nonEmpty.slice(0, TABLE_MAX_ROWS + 1).map((r) => r.length));
  const cols = Math.min(width, TABLE_MAX_COLUMNS);
  const fit = (r: string[]) => Array.from({ length: cols }, (_, i) => cell(r[i] ?? ""));
  const dataRows = nonEmpty.length - 1;
  return {
    columns: fit(nonEmpty[0]!),
    rows: nonEmpty.slice(1, TABLE_MAX_ROWS + 1).map(fit),
    total_rows: dataRows,
    truncated: dataRows > TABLE_MAX_ROWS || width > TABLE_MAX_COLUMNS,
  };
}

// -------------------------------------------------------------------- CSV

/** RFC 4180 parser. The delimiter (`;` or `,`) is picked from the first line. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  let semis = 0;
  let commas = 0;
  let q = false;
  for (const ch of text) {
    if (ch === '"') q = !q;
    else if (!q && (ch === "\n" || ch === "\r")) break;
    else if (!q && ch === ";") semis++;
    else if (!q && ch === ",") commas++;
  }
  const delim = semis > commas ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let touched = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    touched = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
      touched = true;
    } else if (ch === delim) {
      endField();
      touched = true;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
      touched = true;
    }
  }
  if (touched || field !== "" || row.length > 0) endRow();
  return rows;
}

export function tableFromCsv(buf: Buffer): Table {
  let text = buf.toString("utf8");
  if (text.includes("�")) text = buf.toString("latin1");
  return shape(parseCsv(text));
}

// ------------------------------------------------------------------- XLSX

interface CdEntry {
  name: string;
  method: number;
  flags: number;
  compSize: number;
  size: number;
  offset: number;
}

const ZIP_ERR = "Not a valid xlsx file (could not read the ZIP structure).";

function readCentralDirectory(zip: Buffer): CdEntry[] {
  const min = Math.max(0, zip.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = zip.length - 22; i >= min; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(ZIP_ERR);
  const total = zip.readUInt16LE(eocd + 10);
  const cdSize = zip.readUInt32LE(eocd + 12);
  let pos = zip.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || pos === 0xffffffff)
    throw new Error("Unsupported xlsx: zip64 archives are not supported.");
  const entries: CdEntry[] = [];
  const count = Math.min(total, MAX_ZIP_ENTRIES);
  for (let n = 0; n < count; n++) {
    if (pos + 46 > zip.length || zip.readUInt32LE(pos) !== 0x02014b50) throw new Error(ZIP_ERR);
    const nameLen = zip.readUInt16LE(pos + 28);
    const extraLen = zip.readUInt16LE(pos + 30);
    const commentLen = zip.readUInt16LE(pos + 32);
    if (pos + 46 + nameLen > zip.length) throw new Error(ZIP_ERR);
    const compSize = zip.readUInt32LE(pos + 20);
    const size = zip.readUInt32LE(pos + 24);
    const offset = zip.readUInt32LE(pos + 42);
    if (compSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff)
      throw new Error("Unsupported xlsx: zip64 archives are not supported.");
    entries.push({
      name: zip.toString("utf8", pos + 46, pos + 46 + nameLen),
      flags: zip.readUInt16LE(pos + 8),
      method: zip.readUInt16LE(pos + 10),
      compSize,
      size,
      offset,
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function makeReader(zip: Buffer) {
  const entries = readCentralDirectory(zip);
  let totalOut = 0;
  const byName = new Map(entries.map((e) => [e.name, e]));
  return (name: string): string | null => {
    const e = byName.get(name);
    if (!e) return null;
    if (e.flags & 1) throw new Error("Unsupported xlsx: encrypted files are not supported.");
    if (e.method !== 0 && e.method !== 8)
      throw new Error(`Unsupported xlsx: compression method ${e.method} is not supported.`);
    if (e.size > MAX_ENTRY_BYTES || e.compSize > MAX_ENTRY_BYTES)
      throw new Error(`Unsupported xlsx: ${name} is too large.`);
    if (e.offset + 30 > zip.length || zip.readUInt32LE(e.offset) !== 0x04034b50)
      throw new Error(ZIP_ERR);
    const start = e.offset + 30 + zip.readUInt16LE(e.offset + 26) + zip.readUInt16LE(e.offset + 28);
    if (start + e.compSize > zip.length) throw new Error(ZIP_ERR);
    const payload = zip.subarray(start, start + e.compSize);
    let out: Buffer;
    if (e.method === 0) out = payload;
    else {
      try {
        // Cap at the declared size: a lying header cannot inflate past it.
        out = inflateRawSync(payload, { maxOutputLength: Math.max(e.size, 1) });
      } catch {
        throw new Error(`Unsupported xlsx: ${name} is too large or corrupt (zip bomb guard).`);
      }
    }
    if (out.length !== e.size)
      throw new Error(`Unsupported xlsx: ${name} size does not match its header (zip bomb guard).`);
    totalOut += out.length;
    if (totalOut > MAX_TOTAL_BYTES) throw new Error("Unsupported xlsx: contents are too large.");
    return out.toString("utf8");
  };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, g: string) => {
    if (g[0] === "#") {
      const code = g[1] === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    }
    return ENTITIES[g] ?? m;
  });
}
const attr = (tag: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1];

function textRuns(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\s*\/>|<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g))
    out.push(m[1] ? textRuns(m[1]) : "");
  return out;
}

function colIndex(ref: string | undefined): number | null {
  const m = /^([A-Z]{1,3})\d*$/.exec(ref ?? "");
  if (!m) return null;
  let n = 0;
  for (const ch of m[1]!) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function firstSheet(read: (n: string) => string | null): { name: string; xml: string } {
  const wb = read("xl/workbook.xml");
  if (wb === null) throw new Error("Not a valid xlsx file (xl/workbook.xml is missing).");
  const sheetTag = /<sheet\b[^>]*>/.exec(wb)?.[0];
  let name = "Sheet1";
  let path = "xl/worksheets/sheet1.xml";
  if (sheetTag) {
    name = decodeXml(attr(sheetTag, "name") ?? name);
    const rid = attr(sheetTag, "r:id");
    const rels = read("xl/_rels/workbook.xml.rels");
    if (rid && rels) {
      for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
        if (attr(m[0], "Id") !== rid) continue;
        const target = attr(m[0], "Target");
        if (target) path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
      }
    }
  }
  const xml = read(path);
  if (xml === null) throw new Error("Not a valid xlsx file (the first sheet is missing).");
  return { name, xml };
}

export function readXlsx(zip: Buffer): SheetTable {
  if (zip.length < 22) throw new Error(ZIP_ERR);
  const read = makeReader(zip);
  const { name, xml } = firstSheet(read);
  const strings = sharedStrings(read("xl/sharedStrings.xml"));
  const matrix: string[][] = [];
  const keep = TABLE_MAX_ROWS + 1;
  let nonEmpty = 0;
  for (const rowMatch of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const body = rowMatch[1];
    if (!body) continue;
    const cells: string[] = [];
    let next = 0;
    for (const c of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const idx = colIndex(attr(c[1]!, "r")) ?? next;
      next = idx + 1;
      if (idx >= TABLE_MAX_COLUMNS + 1) continue;
      const type = attr(c[1]!, "t");
      const inner = c[2] ?? "";
      let value = "";
      if (type === "inlineStr")
        value = textRuns(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined) {
          if (type === "s") value = strings[Number(v)] ?? "";
          else if (type === "b") value = v.trim() === "1" ? "TRUE" : "FALSE";
          else value = decodeXml(v);
        }
      }
      while (cells.length < idx) cells.push("");
      cells[idx] = value;
    }
    if (!cells.some((v) => v.trim() !== "")) continue;
    nonEmpty++;
    if (matrix.length < keep) matrix.push(cells);
  }
  const t = shape(matrix);
  const dataRows = Math.max(nonEmpty - 1, 0);
  return {
    sheet: cell(name),
    ...t,
    total_rows: dataRows,
    truncated: t.truncated || dataRows > TABLE_MAX_ROWS,
  };
}
