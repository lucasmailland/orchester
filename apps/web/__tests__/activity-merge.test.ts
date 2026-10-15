// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareActivityDesc, mergeActivityPages } from "@/lib/activity/merge";

type Row = { at: string; id: string; kind: string };

const at = (second: number, micros = 0) =>
  `2026-03-01T00:00:${String(second).padStart(2, "0")}.${String(micros).padStart(6, "0")}Z`;

/** What one source returns for a page: its rows after the cursor, newest first, at most limit + 1. */
function sourcePage(rows: Row[], limit: number, cursor: { at: string; id: string } | null) {
  return rows
    .filter((r) => !cursor || compareActivityDesc(r, cursor) > 0)
    .sort(compareActivityDesc)
    .slice(0, limit + 1);
}

describe("compareActivityDesc", () => {
  it("puts the newest first, then the larger id", () => {
    const rows: Row[] = [
      { at: at(1), id: "b", kind: "x" },
      { at: at(2), id: "a", kind: "x" },
      { at: at(1), id: "c", kind: "x" },
      { at: at(1, 1), id: "a", kind: "x" },
    ];
    expect(rows.sort(compareActivityDesc).map((r) => `${r.at.slice(17, 26)}/${r.id}`)).toEqual([
      "02.000000/a",
      "01.000001/a",
      "01.000000/c",
      "01.000000/b",
    ]);
  });

  it("compares ids by code unit, like the C collation the queries use", () => {
    const upper = { at: at(1), id: "Z" };
    const lower = { at: at(1), id: "a" };
    // "a" (0x61) > "Z" (0x5A): the lowercase id comes first in DESC order.
    expect(compareActivityDesc(lower, upper)).toBeLessThan(0);
  });
});

describe("mergeActivityPages", () => {
  it("merges the sources newest first and cuts at the limit", () => {
    const tools: Row[] = [
      { at: at(9), id: "t9", kind: "tool_call" },
      { at: at(5), id: "t5", kind: "tool_call" },
      { at: at(1), id: "t1", kind: "tool_call" },
    ];
    const usage: Row[] = [
      { at: at(8), id: "u8", kind: "model_usage" },
      { at: at(5), id: "u5", kind: "model_usage" },
    ];
    const { rows, next } = mergeActivityPages(
      [sourcePage(tools, 3, null), sourcePage(usage, 3, null)],
      3
    );
    expect(rows.map((r) => r.id)).toEqual(["t9", "u8", "u5"]);
    expect(next).toEqual({ at: at(5), id: "u5" });
  });

  it("returns no cursor when every source is exhausted", () => {
    const a: Row[] = [{ at: at(2), id: "a", kind: "x" }];
    const b: Row[] = [{ at: at(1), id: "b", kind: "y" }];
    const { rows, next } = mergeActivityPages([sourcePage(a, 2, null), sourcePage(b, 2, null)], 2);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(next).toBeNull();
  });

  it("returns a cursor when one source alone fills the page and has more", () => {
    const a: Row[] = [
      { at: at(3), id: "a3", kind: "x" },
      { at: at(2), id: "a2", kind: "x" },
      { at: at(1), id: "a1", kind: "x" },
    ];
    const { rows, next } = mergeActivityPages([sourcePage(a, 2, null), []], 2);
    expect(rows.map((r) => r.id)).toEqual(["a3", "a2"]);
    expect(next).toEqual({ at: at(2), id: "a2" });
  });

  it("walks every row exactly once across pages, including ties on the timestamp", () => {
    const sources: Row[][] = [
      [
        { at: at(5), id: "k", kind: "tool_call" },
        { at: at(5), id: "c", kind: "tool_call" },
        { at: at(3), id: "e", kind: "tool_call" },
        { at: at(1, 500), id: "f", kind: "tool_call" },
      ],
      [
        { at: at(5), id: "m", kind: "model_usage" },
        { at: at(4), id: "a", kind: "model_usage" },
        { at: at(1, 500), id: "g", kind: "model_usage" },
      ],
      [{ at: at(5), id: "d", kind: "config_change" }],
      [],
    ];
    const expected = sources.flat().sort(compareActivityDesc);
    for (const limit of [1, 2, 3, 5, 100]) {
      const seen: string[] = [];
      let cursor: { at: string; id: string } | null = null;
      for (let guard = 0; guard < 50; guard++) {
        const pages = sources.map((rows) => sourcePage(rows, limit, cursor));
        const { rows, next } = mergeActivityPages(pages, limit);
        expect(rows.length).toBeLessThanOrEqual(limit);
        seen.push(...rows.map((r) => r.id));
        if (!next) break;
        cursor = next;
      }
      expect(seen, `limit ${limit}`).toEqual(expected.map((r) => r.id));
    }
  });
});
