// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  applicableKinds,
  decodeCursor,
  describeFilters,
  encodeCursor,
  parseActivityQuery,
} from "@/lib/activity/filters";
import { ACTIVITY_KINDS, type ActivityFilters } from "@/lib/activity/types";

const FROM = "2026-03-01T00:00:00.000Z";
const TO = "2026-03-08T00:00:00.000Z";

function parse(query: Record<string, string | string[]>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  return parseActivityQuery(params);
}

function filters(extra: Partial<ActivityFilters> = {}): ActivityFilters {
  return { from: new Date(FROM), to: new Date(TO), kinds: [...ACTIVITY_KINDS], ...extra };
}

describe("parseActivityQuery", () => {
  it("requires both ends of the range", () => {
    expect(parse({})).toEqual({ ok: false, error: "missing_range", field: "from" });
    expect(parse({ from: FROM })).toEqual({ ok: false, error: "missing_range", field: "to" });
    expect(parse({ to: TO })).toEqual({ ok: false, error: "missing_range", field: "from" });
  });

  it("rejects dates that are not ISO 8601", () => {
    expect(parse({ from: "yesterday", to: TO })).toMatchObject({
      ok: false,
      error: "invalid_date",
      field: "from",
    });
    expect(parse({ from: FROM, to: "2026-13-45T00:00:00Z" })).toMatchObject({
      ok: false,
      error: "invalid_date",
      field: "to",
    });
    expect(parse({ from: "1700000000000", to: TO })).toMatchObject({
      ok: false,
      error: "invalid_date",
    });
  });

  it("rejects a range that ends before it starts or is empty", () => {
    expect(parse({ from: TO, to: FROM })).toMatchObject({ ok: false, error: "invalid_range" });
    expect(parse({ from: FROM, to: FROM })).toMatchObject({ ok: false, error: "invalid_range" });
  });

  it("accepts exactly 92 days and rejects anything longer", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const ninetyTwo = new Date(from.getTime() + 92 * 86_400_000);
    expect(parse({ from: from.toISOString(), to: ninetyTwo.toISOString() }).ok).toBe(true);
    const over = new Date(ninetyTwo.getTime() + 1);
    expect(parse({ from: from.toISOString(), to: over.toISOString() })).toEqual({
      ok: false,
      error: "range_too_long",
      field: "to",
    });
  });

  it("defaults to every kind, a page of 50 and no cursor", () => {
    const result = parse({ from: FROM, to: TO });
    expect(result).toEqual({
      ok: true,
      query: {
        filters: { from: new Date(FROM), to: new Date(TO), kinds: [...ACTIVITY_KINDS] },
        cursor: null,
        limit: 50,
      },
    });
  });

  it("reads kinds comma-separated or repeated, without duplicates", () => {
    const a = parse({ from: FROM, to: TO, kinds: "tool_call,flow_run" });
    const b = parse({ from: FROM, to: TO, kinds: ["tool_call", "flow_run", "tool_call"] });
    for (const r of [a, b]) {
      expect(r.ok && r.query.filters.kinds).toEqual(["tool_call", "flow_run"]);
    }
  });

  it("rejects an unknown kind", () => {
    expect(parse({ from: FROM, to: TO, kinds: "tool_call,emails" })).toEqual({
      ok: false,
      error: "invalid_kind",
      field: "kinds",
    });
  });

  it("rejects an unknown outcome", () => {
    expect(parse({ from: FROM, to: TO, outcome: "maybe" })).toEqual({
      ok: false,
      error: "invalid_outcome",
      field: "outcome",
    });
  });

  it("keeps the id filters, trimmed, and drops empty ones", () => {
    const r = parse({
      from: FROM,
      to: TO,
      agentId: " agent_1 ",
      flowId: "",
      channelId: "ch_1",
      integrationType: "mcp",
      integrationId: "int_1",
      outcome: "error",
      ref: "odoo:4512",
    });
    expect(r.ok && r.query.filters).toEqual({
      from: new Date(FROM),
      to: new Date(TO),
      kinds: [...ACTIVITY_KINDS],
      agentId: "agent_1",
      channelId: "ch_1",
      integrationType: "mcp",
      integrationId: "int_1",
      outcome: "error",
      ref: "odoo:4512",
    });
  });

  it("rejects oversized or malformed filter values", () => {
    expect(parse({ from: FROM, to: TO, ref: "x".repeat(65) })).toEqual({
      ok: false,
      error: "invalid_filter",
      field: "ref",
    });
    expect(parse({ from: FROM, to: TO, agentId: "a".repeat(201) })).toMatchObject({
      ok: false,
      field: "agentId",
    });
    expect(parse({ from: FROM, to: TO, integrationType: "not a type!" })).toMatchObject({
      ok: false,
      field: "integrationType",
    });
  });

  it("clamps the page size to 100 and rejects a non-positive one", () => {
    const big = parse({ from: FROM, to: TO, limit: "500" });
    expect(big.ok && big.query.limit).toBe(100);
    expect(parse({ from: FROM, to: TO, limit: "0" })).toMatchObject({ error: "invalid_limit" });
    expect(parse({ from: FROM, to: TO, limit: "ten" })).toMatchObject({ error: "invalid_limit" });
  });

  it("decodes a cursor it encoded and rejects a tampered one", () => {
    const cursor = { at: "2026-03-02T10:11:12.123456Z", id: "abc123" };
    const r = parse({ from: FROM, to: TO, cursor: encodeCursor(cursor) });
    expect(r.ok && r.query.cursor).toEqual(cursor);
    expect(parse({ from: FROM, to: TO, cursor: "not-a-cursor" })).toEqual({
      ok: false,
      error: "invalid_cursor",
      field: "cursor",
    });
  });
});

describe("cursor encoding", () => {
  it("round-trips and is URL safe", () => {
    const cursor = { at: "2026-03-02T10:11:12.000001Z", id: "id/with+chars=" };
    const encoded = encodeCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it("rejects a timestamp without microseconds, an empty id or extra junk", () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    expect(decodeCursor(enc({ at: "2026-03-02T10:11:12Z", id: "a" }))).toBeNull();
    expect(decodeCursor(enc({ at: "2026-03-02T10:11:12.123456Z", id: "" }))).toBeNull();
    expect(decodeCursor(enc(["2026-03-02T10:11:12.123456Z", "a"]))).toBeNull();
    expect(decodeCursor(enc({ at: "2026-03-02T10:11:12.123456Z" }))).toBeNull();
  });
});

describe("applicableKinds", () => {
  it("keeps every kind without filters", () => {
    expect(applicableKinds(filters())).toEqual([...ACTIVITY_KINDS]);
  });

  it("keeps only the kinds the request asked for", () => {
    expect(applicableKinds(filters({ kinds: ["flow_run", "tool_call"] }))).toEqual([
      "tool_call",
      "flow_run",
    ]);
  });

  it("applies `ref` and the integration type only to tool calls", () => {
    expect(applicableKinds(filters({ ref: "odoo:1" }))).toEqual(["tool_call"]);
    expect(applicableKinds(filters({ integrationType: "mcp" }))).toEqual(["tool_call"]);
  });

  it("applies an outcome to tool calls and flow runs", () => {
    expect(applicableKinds(filters({ outcome: "error" }))).toEqual(["tool_call", "flow_run"]);
    // A flow run is never refused.
    expect(applicableKinds(filters({ outcome: "refused" }))).toEqual(["tool_call"]);
  });

  it("applies an agent to the sources that record one and to changes of that agent", () => {
    expect(applicableKinds(filters({ agentId: "a" }))).toEqual([
      "tool_call",
      "model_usage",
      "conversation",
      "config_change",
    ]);
  });

  it("applies a flow and a channel to the sources that record them", () => {
    expect(applicableKinds(filters({ flowId: "f" }))).toEqual([
      "tool_call",
      "model_usage",
      "flow_run",
      "config_change",
    ]);
    expect(applicableKinds(filters({ channelId: "c" }))).toEqual([
      "tool_call",
      "conversation",
      "config_change",
    ]);
  });

  it("skips config changes when two targets are asked for at once", () => {
    expect(applicableKinds(filters({ agentId: "a", channelId: "c" }))).toEqual([
      "tool_call",
      "conversation",
    ]);
  });

  it("returns nothing when no kind can satisfy the filters together", () => {
    expect(applicableKinds(filters({ kinds: ["conversation"], ref: "odoo:1" }))).toEqual([]);
  });
});

describe("describeFilters", () => {
  it("gives the filters as plain JSON for the audit entry", () => {
    expect(
      describeFilters(filters({ kinds: ["tool_call"], integrationType: "mcp", ref: "odoo:" }))
    ).toEqual({
      from: FROM,
      to: TO,
      kinds: ["tool_call"],
      integrationType: "mcp",
      ref: "odoo:",
    });
  });
});
