// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// The activity endpoints: who may call them, how they read the query string,
// and what the export writes. The database layer is mocked here; the
// integration suite (tests/integration/activity) runs it for real.

const h = vi.hoisted(() => ({
  auth: { userId: "user_1" } as { userId: string } | null,
  role: "admin" as string | null,
  status: "active",
  query: vi.fn(),
  totals: vi.fn(),
  exportRows: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@orchester/db", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: async () =>
    h.auth
      ? { user: { id: h.auth.userId, email: "", name: "" } }
      : NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}));
vi.mock("@/lib/tenant/resolve", () => ({
  resolveBySlug: async (slug: string) =>
    slug === "missing" ? null : { id: "ws_1", slug, name: "Workspace", status: h.status },
}));
vi.mock("@/lib/tenant/membership", () => ({
  checkMembership: async () => (h.role ? { role: h.role } : null),
}));
vi.mock("@/lib/tenant/cluster-cache", () => ({
  broadcastInvalidation: vi.fn(),
  onInvalidation: vi.fn(),
  startListener: vi.fn(),
}));
vi.mock("@/lib/activity/query", () => ({
  queryActivity: h.query,
  activityTotals: h.totals,
  exportActivity: h.exportRows,
}));
vi.mock("@/lib/audit/log", () => ({ appendAuditSync: h.audit }));

const FROM = "2026-03-01T00:00:00.000Z";
const TO = "2026-03-08T00:00:00.000Z";

function request(path: string, params: Record<string, string> = {}) {
  const url = new URL(`https://app.test/api/workspaces/team-one/activity${path}`);
  url.searchParams.set("from", FROM);
  url.searchParams.set("to", TO);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url);
}

const ctx = (slug = "team-one") => ({ params: Promise.resolve({ slug }) });

async function list(params: Record<string, string> = {}, slug?: string) {
  const { GET } = await import("@/app/api/workspaces/[slug]/activity/route");
  return GET(request("", params), ctx(slug));
}

async function exportCsv(params: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/workspaces/[slug]/activity/export/route");
  return GET(request("/export", params), ctx());
}

const row = {
  id: "tc1",
  at: "2026-03-02T00:00:00.000001Z",
  kind: "tool_call",
  agent: { id: "ag1", name: "=evil()" },
  flow: null,
  channel: null,
  integration: { type: "mcp", id: "int1", name: "Data source" },
  ref: null,
  outcome: "ok",
  tokens: null,
  costUsd: null,
  durationMs: 5,
  summary: "mcp__int1__lookup",
  link: null,
  detail: { kind: "tool_call", input: {} },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.auth = { userId: "user_1" };
  h.role = "admin";
  h.status = "active";
  h.query.mockResolvedValue({ rows: [row], nextCursor: null });
  h.totals.mockResolvedValue({ counts: { tool_call: 1 } });
  h.exportRows.mockResolvedValue({ rows: [row], truncated: false });
  h.audit.mockResolvedValue(undefined);
});

describe("activity.read", () => {
  it("is granted to owner and admin only", async () => {
    const { can } = await import("@/lib/rbac");
    expect(can("owner", "activity.read")).toBe(true);
    expect(can("admin", "activity.read")).toBe(true);
    expect(can("editor", "activity.read")).toBe(false);
    expect(can("viewer", "activity.read")).toBe(false);
  });
});

describe.each([
  ["GET /activity", list],
  ["GET /activity/export", exportCsv],
])("%s access", (_name, call) => {
  it.each(["editor", "viewer", "member"])("refuses the %s role with 403", async (role) => {
    h.role = role;
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "role_insufficient" });
    expect(h.query).not.toHaveBeenCalled();
    expect(h.exportRows).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it.each(["admin", "owner"])("lets the %s role in", async (role) => {
    h.role = role;
    expect((await call()).status).toBe(200);
  });

  it("refuses a non-member with 403", async () => {
    h.role = null;
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_a_member" });
  });

  it("returns 401 without a session", async () => {
    h.auth = null;
    expect((await call()).status).toBe(401);
  });

  it("returns 423 for a suspended workspace", async () => {
    h.status = "suspended";
    expect((await call()).status).toBe(423);
  });

  it("rejects bad filters with 400 before reading anything", async () => {
    const res = await call({ kinds: "tool_call,nope" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_kind", field: "kinds" });
    expect(h.query).not.toHaveBeenCalled();
    expect(h.exportRows).not.toHaveBeenCalled();
  });
});

describe("GET /activity", () => {
  it("returns 404 for an unknown workspace", async () => {
    expect((await list({}, "missing")).status).toBe(404);
  });

  it("reads the caller's workspace and returns totals on the first page", async () => {
    h.query.mockResolvedValue({
      rows: [row],
      nextCursor: { at: "2026-03-02T00:00:00.000001Z", id: "tc1" },
    });
    const res = await list({ limit: "10", integrationType: "mcp" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(h.query).toHaveBeenCalledWith(
      "ws_1",
      expect.objectContaining({ integrationType: "mcp", from: new Date(FROM), to: new Date(TO) }),
      { cursor: null, limit: 10 }
    );
    expect(h.totals).toHaveBeenCalledWith(
      "ws_1",
      expect.objectContaining({ integrationType: "mcp" })
    );
    expect(body.rows).toEqual([row]);
    expect(body.totals).toEqual({ counts: { tool_call: 1 } });
    const { decodeCursor } = await import("@/lib/activity/filters");
    expect(decodeCursor(body.nextCursor)).toEqual({ at: "2026-03-02T00:00:00.000001Z", id: "tc1" });
  });

  it("skips the totals on later pages", async () => {
    const { encodeCursor } = await import("@/lib/activity/filters");
    const cursor = { at: "2026-03-02T00:00:00.000001Z", id: "tc1" };
    const res = await list({ cursor: encodeCursor(cursor) });
    expect(res.status).toBe(200);
    expect((await res.json()).totals).toBeNull();
    expect(h.totals).not.toHaveBeenCalled();
    expect(h.query.mock.calls[0]![2]).toEqual({ cursor, limit: 50 });
  });
});

describe("GET /activity/export", () => {
  it("returns guarded CSV and records the export with its filters and row count", async () => {
    const res = await exportCsv({ integrationType: "mcp", ref: "odoo:" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="activity-team-one-20260301-20260308.csv"'
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    const csv = await res.text();
    expect(csv).toContain(",'=evil(),");
    expect(h.exportRows).toHaveBeenCalledWith(
      "ws_1",
      expect.objectContaining({ integrationType: "mcp", ref: "odoo:" })
    );
    expect(h.audit).toHaveBeenCalledWith("ws_1", {
      action: "activity.export",
      actorUserId: "user_1",
      actorKind: "user",
      targetType: "workspace",
      targetId: "ws_1",
      meta: {
        filters: {
          from: FROM,
          to: TO,
          kinds: ["tool_call", "model_usage", "flow_run", "conversation", "config_change"],
          integrationType: "mcp",
          ref: "odoo:",
        },
        rows: 1,
        truncated: false,
      },
    });
  });

  it("flags a truncated export", async () => {
    h.exportRows.mockResolvedValue({ rows: [row], truncated: true });
    const res = await exportCsv();
    expect(res.headers.get("x-activity-truncated")).toBe("true");
    expect(h.audit.mock.calls[0]![1].meta).toMatchObject({ rows: 1, truncated: true });
  });

  it("does not hand out the file when the export cannot be audited", async () => {
    h.audit.mockRejectedValue(new Error("db down"));
    const res = await exportCsv();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "audit_failed" });
  });
});
