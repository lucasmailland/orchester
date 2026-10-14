// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Array<{ table: unknown; row: Record<string, unknown> }>,
  log: vi.fn(),
  withWorkspaceTx: vi.fn(),
}));

vi.mock("@orchester/db", () => ({
  getDb: vi.fn(() => ({})),
  schema: { toolCalls: { table: "tool_call" } },
}));
vi.mock("@/lib/tenant/context", () => ({ withWorkspaceTx: h.withWorkspaceTx }));
vi.mock("@/lib/observability", () => ({ logWithContext: h.log, recordMetric: vi.fn() }));

import {
  integrationOf,
  outcomeOf,
  recordToolCall,
  sanitizeToolInput,
  toolCallRef,
  type ToolCallEntry,
} from "@/lib/activity/tool-calls";

const fakeTx = {
  insert: (table: unknown) => ({
    values: async (row: Record<string, unknown>) => {
      h.rows.push({ table, row });
    },
  }),
};

beforeEach(() => {
  h.rows = [];
  h.log.mockReset();
  h.withWorkspaceTx.mockReset();
  h.withWorkspaceTx.mockImplementation(async (_ws: string, fn: (tx: unknown) => unknown) =>
    fn(fakeTx)
  );
});

describe("sanitizeToolInput", () => {
  it("drops secret-looking keys at any depth", () => {
    const out = sanitizeToolInput({
      query: "vpn",
      api_key: "k1",
      apiKey: "k2",
      headers: { Authorization: "Bearer x", Accept: "json", Cookie: "c" },
      nested: { deeper: { client_secret: "s", password: "p", keep: 1 } },
      list: [{ access_token: "t", id: 4512 }],
    });
    expect(out).toEqual({
      query: "vpn",
      headers: { Accept: "json" },
      nested: { deeper: { keep: 1 } },
      list: [{ id: 4512 }],
    });
    expect(JSON.stringify(out)).not.toMatch(/k1|k2|Bearer|"s"|"p"|"t"/);
  });

  it("truncates long strings with an ellipsis", () => {
    const out = sanitizeToolInput({ body: "x".repeat(250), short: "ok" });
    expect(out.body).toBe("x".repeat(200) + "…");
    expect(out.short).toBe("ok");
  });

  it("keeps at most 20 array items and marks the rest", () => {
    const out = sanitizeToolInput({ ids: Array.from({ length: 25 }, (_, i) => i) });
    const ids = out.ids as unknown[];
    expect(ids).toHaveLength(21);
    expect(ids.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(ids[20]).toBe("[+5 more]");
  });

  it("replaces containers nested deeper than 4 levels", () => {
    const out = sanitizeToolInput({ a: { b: { c: { d: { e: { f: 1 } }, ok: 2 } } } });
    expect(out).toEqual({ a: { b: { c: { d: "[depth]", ok: 2 } } } });
  });

  it("keeps only the top-level keys when the result is still too large", () => {
    const big = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`k${i}`, "y".repeat(150)])
    );
    const out = sanitizeToolInput({ ...big, password: "p" });
    expect(out).toEqual({ _truncated: true, keys: Object.keys(big) });
  });

  it("masks query values and credentials in URLs", () => {
    const out = sanitizeToolInput({ url: "https://user:pw@api.example.com/v1?sig=abc&id=4512" });
    expect(out.url).toBe("https://api.example.com/v1?sig=***&id=***");
  });

  it("masks URLs inside longer text, like a note body", () => {
    const out = sanitizeToolInput({
      body_markdown: "See https://erp.example.com/web/content/9?access_token=abc123 for the file.",
    });
    expect(out.body_markdown).toBe(
      "See https://erp.example.com/web/content/9?access_token=*** for the file."
    );
  });

  it("returns an empty object for anything that is not an object", () => {
    expect(sanitizeToolInput(null)).toEqual({});
    expect(sanitizeToolInput("text")).toEqual({});
    expect(sanitizeToolInput([1, 2])).toEqual({});
  });

  it("is pure: the input is left untouched", () => {
    const input = { password: "p", body: "x".repeat(300) };
    sanitizeToolInput(input);
    expect(input).toEqual({ password: "p", body: "x".repeat(300) });
  });
});

describe("toolCallRef", () => {
  it("prefers an explicit ticket_ref, capped at 64 chars", () => {
    expect(toolCallRef("mcp__helpdesk__lookup", { ticket_ref: "T-4512" })).toBe("T-4512");
    expect(toolCallRef("anything", { ticket_ref: "r".repeat(80) })).toHaveLength(64);
  });

  it("uses the task or ticket id of odoo tools and flow steps", () => {
    expect(toolCallRef("odoo_get_task", { id: 4512 })).toBe("odoo:4512");
    expect(toolCallRef("odoo_post_task_note", { id: "4512", body_markdown: "x" })).toBe(
      "odoo:4512"
    );
    expect(toolCallRef("odoo_get_attachment_table", { attachment_id: 9, task_id: 4512 })).toBe(
      "odoo:4512"
    );
    expect(toolCallRef("odoo::get_ticket", { ticket_id: 77 })).toBe("odoo:77");
  });

  it("does not take a partner id for a task", () => {
    expect(toolCallRef("odoo_get_partner", { id: 31 })).toBeUndefined();
  });

  it("is undefined for other tools or without an id", () => {
    expect(toolCallRef("calculator", { id: 4512 })).toBeUndefined();
    expect(toolCallRef("odoo_search_tasks", { query: "vpn" })).toBeUndefined();
    expect(toolCallRef("odoo_get_task", { id: { nested: 1 } })).toBeUndefined();
  });
});

describe("integrationOf", () => {
  it("reads the integration key of an MCP tool", () => {
    expect(integrationOf("mcp__docs__read_page", {})).toEqual({ type: "mcp", id: "docs" });
  });

  it("maps typed connector tools to their connector", () => {
    expect(integrationOf("odoo_get_task", { id: 4512 })).toEqual({ type: "odoo" });
    expect(integrationOf("gitlab_read_file", {})).toEqual({ type: "gitlab" });
  });

  it("takes run_integration's integrationId", () => {
    expect(integrationOf("run_integration", { integrationId: "newrelic", action: "x" })).toEqual({
      type: "newrelic",
    });
  });

  it("reads the integration of a flow step name", () => {
    expect(integrationOf("odoo::post_note", {})).toEqual({ type: "odoo" });
  });

  it("is empty for built-ins", () => {
    expect(integrationOf("calculator", {})).toEqual({});
    expect(integrationOf("run_integration", {})).toEqual({});
  });
});

describe("outcomeOf", () => {
  it("calls a plain result ok", () => {
    expect(outcomeOf({ result: { rows: [] } })).toEqual({ outcome: "ok" });
    expect(outcomeOf({ result: "text" })).toEqual({ outcome: "ok" });
  });

  it("calls a thrown error an error, keeping a bounded message", () => {
    const e = new TypeError("y".repeat(600));
    const out = outcomeOf({ thrown: e });
    expect(out.outcome).toBe("error");
    expect(out.errorCode).toBe("TypeError");
    expect(out.error).toHaveLength(500);
  });

  it("masks URLs in error messages and leaves a bare Error without a code", () => {
    const e = new Error("fetch failed: https://api.example.com/v1?sig=abc");
    expect(outcomeOf({ thrown: e })).toEqual({
      outcome: "error",
      error: "fetch failed: https://api.example.com/v1?sig=***",
    });
  });

  it("calls a write-scope refusal refused", () => {
    const e = new Error(
      "Agents may only write to tasks of project 12; task 4512 is in project 31."
    );
    expect(outcomeOf({ thrown: e })).toMatchObject({
      outcome: "refused",
      errorCode: "write_scope",
    });
  });

  it("reads errors reported in the result", () => {
    expect(
      outcomeOf({ result: { isError: true, content: [{ type: "text", text: "nope" }] } })
    ).toMatchObject({ outcome: "error", error: "nope" });
    expect(outcomeOf({ result: { error: "not found", code: "E404" } })).toEqual({
      outcome: "error",
      errorCode: "E404",
      error: "not found",
    });
  });
});

const base = {
  workspaceId: "ws_1",
  source: "channel" as const,
  tool: "odoo_get_task",
  input: { id: 4512, token: "tok" },
  agentId: "agent_1",
  conversationId: "conv_1",
  channelId: "channel_1",
  startedAt: new Date("2026-01-01T00:00:00Z"),
  durationMs: 12,
};
const entry = (result: unknown = { name: "OUTPUT-MARKER task title" }): ToolCallEntry => ({
  ...base,
  result,
});

describe("recordToolCall", () => {
  it("inserts one row in its own workspace transaction, without the output", async () => {
    await recordToolCall(entry());
    expect(h.withWorkspaceTx).toHaveBeenCalledTimes(1);
    expect(h.withWorkspaceTx.mock.calls[0]![0]).toBe("ws_1");
    expect(h.rows).toHaveLength(1);
    const { table, row } = h.rows[0]!;
    expect(table).toEqual({ table: "tool_call" });
    expect(row).toMatchObject({
      workspaceId: "ws_1",
      source: "channel",
      agentId: "agent_1",
      conversationId: "conv_1",
      channelId: "channel_1",
      tool: "odoo_get_task",
      integrationType: "odoo",
      ref: "odoo:4512",
      input: { id: 4512 },
      outcome: "ok",
      durationMs: 12,
      resultSize: JSON.stringify({ name: "OUTPUT-MARKER task title" }).length,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(typeof row.id).toBe("string");
    expect(JSON.stringify(row)).not.toContain("OUTPUT-MARKER");
    expect(JSON.stringify(row)).not.toContain("tok");
  });

  it("records a thrown error with its message and no result size", async () => {
    await recordToolCall({ ...base, thrown: new Error("odoo down") });
    expect(h.rows[0]!.row).toMatchObject({
      outcome: "error",
      error: "odoo down",
      resultSize: null,
    });
  });

  it("stores a null result size when the result cannot be serialized", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await recordToolCall(entry(circular));
    expect(h.rows[0]!.row.resultSize).toBeNull();
  });

  it("never throws: a failed insert is logged with the tool name only", async () => {
    h.withWorkspaceTx.mockRejectedValue(new Error("connection refused"));
    await expect(recordToolCall(entry())).resolves.toBeUndefined();
    expect(h.log).toHaveBeenCalledWith("warn", "tool_call.record_failed", {
      tool: "odoo_get_task",
      error: "connection refused",
    });
    expect(JSON.stringify(h.log.mock.calls)).not.toContain("4512");
  });

  it("does not wait forever for a pool connection", async () => {
    vi.useFakeTimers();
    try {
      h.withWorkspaceTx.mockImplementation(() => new Promise(() => {}));
      const done = vi.fn();
      void recordToolCall(entry()).then(done);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(done).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toHaveBeenCalled();
      expect(h.log).toHaveBeenCalledWith("warn", "tool_call.record_slow", {
        tool: "odoo_get_task",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("migration 0064", () => {
  const dbDir = resolve(__dirname, "../../../packages/db");
  const sql = readFileSync(resolve(dbDir, "migrations/0064_tool_call.sql"), "utf8");

  it("creates the table idempotently with forced row level security", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS tool_call");
    expect(sql).toContain("ALTER TABLE tool_call ENABLE ROW LEVEL SECURITY;");
    expect(sql).toMatch(/ALTER TABLE tool_call FORCE\s+ROW LEVEL SECURITY;/);
  });

  it("has select, insert and delete policies and no update policy", () => {
    for (const p of ["tool_call_select", "tool_call_insert", "tool_call_delete"]) {
      expect(sql).toContain(`policyname = '${p}'`);
    }
    expect(sql).not.toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/REVOKE UPDATE ON tool_call FROM app_user/);
  });

  it("constrains source and outcome", () => {
    expect(sql).toMatch(
      /source\s+text NOT NULL\s+CHECK \(source IN \('channel','test_chat','api','flow_agent','flow_step','mcp_server'\)\)/
    );
    expect(sql).toMatch(
      /outcome\s+text NOT NULL\s+CHECK \(outcome IN \('ok','error','refused'\)\)/
    );
  });

  it("keeps rows when agents, flows or conversations are deleted", () => {
    expect(sql.match(/REFERENCES/g)).toHaveLength(1);
    expect(sql).toContain("REFERENCES workspace(id) ON DELETE CASCADE");
  });

  it("is registered in the manifest", () => {
    const manifest = readFileSync(resolve(dbDir, "scripts/manifest.mjs"), "utf8");
    expect(manifest).toContain('"0064_tool_call.sql"');
  });

  it("is mirrored in the drizzle schema", () => {
    const schema = readFileSync(resolve(dbDir, "src/schema/activity.ts"), "utf8");
    expect(schema).toContain('pgTable("tool_call"');
    const index = readFileSync(resolve(dbDir, "src/schema/index.ts"), "utf8");
    expect(index).toContain('export * from "./activity";');
  });
});
