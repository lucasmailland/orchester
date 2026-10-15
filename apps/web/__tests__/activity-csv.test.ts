// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ACTIVITY_CSV_COLUMNS, activityCsv, csvCell, csvLine } from "@/lib/activity/csv";
import type { ActivityRow } from "@/lib/activity/types";

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(0.000123)).toBe("0.000123");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("true");
  });

  it("quotes values with commas, quotes or line breaks, doubling inner quotes (RFC 4180)", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell("cr\rhere")).toBe('"cr\rhere"');
  });

  it.each([
    ["=SUM(A1:A2)", "'=SUM(A1:A2)"],
    ["+1", "'+1"],
    ["-2+3", "'-2+3"],
    ["@cmd", "'@cmd"],
    ["\tlead", "'\tlead"],
  ])("defuses a formula in %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("defuses a leading carriage return and still quotes it", () => {
    expect(csvCell("\r=1")).toBe(`"'\r=1"`);
  });

  it("defuses a formula that also needs quoting", () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });

  it("only looks at the first character", () => {
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("odoo:-1")).toBe("odoo:-1");
  });

  it("serializes objects as JSON", () => {
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe("csvLine", () => {
  it("joins cells with commas and ends with CRLF", () => {
    expect(csvLine(["a", "b,c", null])).toBe('a,"b,c",\r\n');
  });
});

const row: ActivityRow = {
  id: "tc1",
  at: "2026-03-01T10:00:00.123456Z",
  kind: "tool_call",
  agent: { id: "ag1", name: "=cmd|' /C calc'!A0" },
  flow: null,
  channel: { id: "ch1", name: "Support, main" },
  integration: { type: "mcp", id: "int1", name: "Data source" },
  ref: "odoo:4512",
  outcome: "ok",
  tokens: null,
  costUsd: null,
  durationMs: 120,
  summary: "mcp__int1__lookup",
  link: "/conversations/cv1",
  detail: {
    kind: "tool_call",
    source: "channel",
    tool: "mcp__int1__lookup",
    input: { q: "x" },
    errorCode: null,
    error: null,
    resultSize: 10,
    conversationId: "cv1",
    flowRunId: null,
    nodeId: null,
  },
};

describe("activityCsv", () => {
  it("starts with a BOM and the header row", () => {
    const csv = activityCsv([]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1)).toBe(`${ACTIVITY_CSV_COLUMNS.join(",")}\r\n`);
  });

  it("writes one line per row, in column order, with every cell guarded", () => {
    const csv = activityCsv([row]);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(3); // header, row, trailing empty
    const header = lines[0]!.split(",");
    const cells = lines[1]!;
    expect(header[0]).toBe("at");
    expect(cells.startsWith("2026-03-01T10:00:00.123456Z,tool_call,ag1,")).toBe(true);
    // The agent name is a formula: it is prefixed (no CSV quoting needed).
    expect(cells).toContain(",'=cmd|' /C calc'!A0,");
    expect(cells).toContain('"Support, main"');
    expect(cells).toContain('"{""kind"":""tool_call""');
  });
});
