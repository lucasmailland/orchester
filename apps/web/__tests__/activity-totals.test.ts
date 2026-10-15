// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  foldOutcomeCounts,
  foldSpend,
  matchIntegration,
  sumOutcomeCounts,
  sumSpend,
} from "@/lib/activity/totals";

describe("foldOutcomeCounts", () => {
  it("folds (key, outcome, count) rows into one entry per key, busiest first", () => {
    const folded = foldOutcomeCounts([
      { key: "odoo_get_task", outcome: "ok", count: 3 },
      { key: "mcp__x__lookup", outcome: "ok", count: 7 },
      { key: "odoo_get_task", outcome: "error", count: 2 },
      { key: "odoo_get_task", outcome: "refused", count: 1 },
      { key: "mcp__x__lookup", outcome: "error", count: 1 },
      { key: "calculator", outcome: "ok", count: 1 },
    ]);
    expect(folded).toEqual([
      { key: "mcp__x__lookup", total: 8, ok: 7, error: 1, refused: 0 },
      { key: "odoo_get_task", total: 6, ok: 3, error: 2, refused: 1 },
      { key: "calculator", total: 1, ok: 1, error: 0, refused: 0 },
    ]);
  });

  it("keeps a null key as its own entry and breaks ties by key", () => {
    const folded = foldOutcomeCounts([
      { key: "b", outcome: "ok", count: 1 },
      { key: null, outcome: "ok", count: 1 },
      { key: "a", outcome: "ok", count: 1 },
    ]);
    expect(folded.map((f) => f.key)).toEqual([null, "a", "b"]);
  });

  it("caps the list", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ key: `t${i}`, outcome: "ok", count: i }));
    expect(foldOutcomeCounts(rows, 3).map((f) => f.key)).toEqual(["t9", "t8", "t7"]);
  });

  it("ignores counts of an outcome it does not know", () => {
    expect(foldOutcomeCounts([{ key: "a", outcome: "weird", count: 4 }])).toEqual([
      { key: "a", total: 4, ok: 0, error: 0, refused: 0 },
    ]);
  });
});

describe("sumOutcomeCounts", () => {
  it("adds every row", () => {
    expect(
      sumOutcomeCounts([
        { key: "a", outcome: "ok", count: 2 },
        { key: "b", outcome: "error", count: 3 },
        { key: "c", outcome: "refused", count: 1 },
      ])
    ).toEqual({ total: 6, ok: 2, error: 3, refused: 1 });
  });
});

const spend = (key: string | null, costUsd: number, tokens: Partial<Record<string, number>>) => ({
  key,
  events: 1,
  costUsd,
  tokensIn: tokens.in ?? 0,
  tokensOut: tokens.out ?? 0,
  cacheWrite: tokens.cacheWrite ?? 0,
  cacheRead: tokens.cacheRead ?? 0,
  tokensTotal: tokens.total ?? 0,
});

describe("foldSpend", () => {
  it("merges rows with the same key and sorts by cost", () => {
    const folded = foldSpend([
      spend("agent_a", 0.5, { in: 100, out: 10, total: 110 }),
      spend("agent_b", 2, { total: 900 }),
      spend("agent_a", 0.25, { in: 50, cacheRead: 40, total: 90 }),
      spend(null, 0.1, { total: 5 }),
    ]);
    expect(folded).toEqual([
      {
        key: "agent_b",
        events: 1,
        costUsd: 2,
        tokens: { in: 0, out: 0, cacheWrite: 0, cacheRead: 0, total: 900 },
      },
      {
        key: "agent_a",
        events: 2,
        costUsd: 0.75,
        tokens: { in: 150, out: 10, cacheWrite: 0, cacheRead: 40, total: 200 },
      },
      {
        key: null,
        events: 1,
        costUsd: 0.1,
        tokens: { in: 0, out: 0, cacheWrite: 0, cacheRead: 0, total: 5 },
      },
    ]);
  });

  it("does not lose cents to floating point", () => {
    const folded = foldSpend([spend("a", 0.1, {}), spend("a", 0.2, {})]);
    expect(folded[0]!.costUsd).toBe(0.3);
  });

  it("sums the grand total", () => {
    expect(
      sumSpend([spend("a", 0.1, { in: 1, total: 2 }), spend(null, 0.2, { out: 3, total: 3 })])
    ).toEqual({
      events: 2,
      costUsd: 0.3,
      tokens: { in: 1, out: 3, cacheWrite: 0, cacheRead: 0, total: 5 },
    });
  });
});

describe("matchIntegration", () => {
  const integrations = [
    { id: "k3m9x2a7b1c4d8e6f0g5h2j4", name: "Data source", type: "mcp" },
    { id: "p1q2r3s4t5u6v7w8x9y0z1a2", name: "Other source", type: "mcp" },
    { id: "p1q2r3s4t5u6v7w8x9y0zzzz", name: "Look-alike", type: "mcp" },
  ];

  it("matches the full id of a readable tool name", () => {
    expect(matchIntegration("k3m9x2a7b1c4d8e6f0g5h2j4", integrations)?.name).toBe("Data source");
  });

  it("matches the 20-character prefix a hashed tool name keeps", () => {
    expect(matchIntegration("k3m9x2a7b1c4d8e6f0g5", integrations)?.name).toBe("Data source");
  });

  it("refuses an ambiguous prefix and an unknown key", () => {
    expect(matchIntegration("p1q2r3s4t5u6v7w8x9y0", integrations)).toBeNull();
    expect(matchIntegration("nope", integrations)).toBeNull();
    expect(matchIntegration("k3m9x2a7b1c4d8e6", integrations)).toBeNull();
  });
});
