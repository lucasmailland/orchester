// @vitest-environment node
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  maskSensitive,
  parseCsv,
  readXlsx,
  tableFromCsv,
} from "@/lib/integrations/attachment-table";
import { buildXlsx, buildZip } from "./helpers/zip";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded delimiters and newlines, CRLF", () => {
    const text = 'a,b,c\r\n"x, y","say ""hi""","l1\nl2"\r\n1,2,3';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "l1\nl2"],
      ["1", "2", "3"],
    ]);
  });
  it("detects ; from the first line and ignores a BOM", () => {
    expect(parseCsv("﻿a;b\n1,5;2\n")).toEqual([
      ["a", "b"],
      ["1,5", "2"],
    ]);
  });
  it("does not count delimiters inside quotes in the first line", () => {
    expect(parseCsv('"a;b;c",d\n1,2')).toEqual([
      ["a;b;c", "d"],
      ["1", "2"],
    ]);
  });
});

describe("tableFromCsv", () => {
  it("returns header, 50 rows, total and truncation, cells trimmed to 200 chars", () => {
    const lines = ["h1,h2"];
    for (let i = 0; i < 60; i++) lines.push(`${i},${"x".repeat(300)}`);
    const t = tableFromCsv(Buffer.from(lines.join("\n")));
    expect(t.columns).toEqual(["h1", "h2"]);
    expect(t.rows).toHaveLength(50);
    expect(t.total_rows).toBe(60);
    expect(t.truncated).toBe(true);
    expect(t.rows[0]![1]).toHaveLength(200);
  });
  it("caps at 30 columns", () => {
    const row = Array.from({ length: 40 }, (_, i) => `c${i}`).join(",");
    const t = tableFromCsv(Buffer.from(`${row}\n${row}`));
    expect(t.columns).toHaveLength(30);
    expect(t.rows[0]).toHaveLength(30);
    expect(t.truncated).toBe(true);
  });
});

describe("maskSensitive", () => {
  it.each([
    ["20-12345678-9", "[num]"],
    ["12.345.678", "[num]"],
    ["30123456789", "[num]"],
    ["+54 9 11 1234-5678", "+[num]"],
    ["11 4567 8901", "[num]"],
    ["ana.perez+x@example.com", "[email]"],
    ["write to juan12345678@corp.com now", "write to [email] now"],
    ["DNI 12345678.", "DNI [num]."],
  ])("masks %s", (input, out) => expect(maskSensitive(input)).toBe(out));
  it.each([
    "8.5",
    "2026-10-08",
    "09:30",
    "2026-10-08 09:30",
    "2026-10-08T09:30:00",
    "123456",
    "12/10/2026",
    "42",
  ])("keeps %s", (s) => expect(maskSensitive(s)).toBe(s));
});

describe("readXlsx", () => {
  it("reads shared strings, inline strings, numbers and booleans from the first sheet", () => {
    const t = readXlsx(buildXlsx());
    expect(t.sheet).toBe("Horas");
    expect(t.columns).toEqual(["Name", "Hours", "Note"]);
    expect(t.rows).toEqual([
      ["Ana & Co", "8.5", "DNI [num]"],
      ["mail [email]", "", "TRUE"],
    ]);
    expect(t.total_rows).toBe(2);
    expect(t.truncated).toBe(false);
  });
  it("limits to 50 rows and reports the total", () => {
    const t = readXlsx(buildXlsx({ rows: 80 }));
    expect(t.rows).toHaveLength(50);
    expect(t.total_rows).toBe(82);
    expect(t.truncated).toBe(true);
  });
  it("refuses a bomb whose declared size is small but inflates huge", () => {
    const huge = Buffer.alloc(25 * 1024 * 1024);
    const zip = buildZip([
      {
        name: "xl/workbook.xml",
        data: Buffer.from("<x/>"),
        raw: deflateRawSync(huge),
        declaredSize: 10,
      },
    ]);
    expect(() => readXlsx(zip)).toThrow(/too large|zip bomb|size/i);
  });
  it("refuses a declared size above the per-entry cap", () => {
    const zip = buildZip([
      { name: "xl/workbook.xml", data: Buffer.from("x"), declaredSize: 21 * 1024 * 1024 },
    ]);
    expect(() => readXlsx(zip)).toThrow(/too large/i);
  });
  it("refuses encrypted entries", () => {
    const zip = buildZip([{ name: "xl/workbook.xml", data: Buffer.from("<x/>"), flags: 1 }]);
    expect(() => readXlsx(zip)).toThrow(/encrypted/i);
  });
  it("refuses zip64 and unsupported compression methods", () => {
    expect(() =>
      readXlsx(buildZip([{ name: "a", data: Buffer.from("x") }], { zip64Marker: true }))
    ).toThrow(/zip64/i);
    expect(() =>
      readXlsx(buildZip([{ name: "xl/workbook.xml", data: Buffer.from("x"), method: 12 }]))
    ).toThrow(/compression/i);
  });
  it("refuses non-zip input", () => {
    expect(() => readXlsx(Buffer.from("not a zip at all"))).toThrow(/not a valid xlsx/i);
  });
  it("only considers the first 50 entries", () => {
    const filler = Array.from({ length: 50 }, (_, i) => ({
      name: `f${i}`,
      data: Buffer.from("x"),
    }));
    const zip = buildZip([...filler, { name: "xl/workbook.xml", data: Buffer.from("<x/>") }]);
    expect(() => readXlsx(zip)).toThrow(/workbook/i);
  });
});
