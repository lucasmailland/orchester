// apps/web/__tests__/mnemo-decision-bom-endpoint.test.ts
//
// Behavioral unit tests for GET /api/mnemo/decisions/[traceId].
// Tests the kill-switch and traceId validation guard WITHOUT spinning a DB.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// server-only is already aliased to __mocks__/server-only.ts via vitest.config
// Mock auth, db, mnemosyne and safe-log so the route is importable
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    user: { id: "u1", email: "u@test.com", name: "Test" },
    workspace: { id: "ws1", name: "Test WS", slug: "test" },
    role: "owner",
  }),
  isAuthContext: (x: unknown) => !(x instanceof Response),
}));
vi.mock("@mnemosyne/core", () => ({
  composeBOM: vi.fn(),
  completenessScore: vi.fn(() => 1),
  withMnemoTx: vi.fn(),
}));
vi.mock("@orchester/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/safe-log", () => ({ safeLogError: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  delete process.env["MNEMO_DECISION_BOM"];
  vi.clearAllMocks();
});

describe("/api/mnemo/decisions/[traceId]", () => {
  it("returns {available:false, reason:'feature_disabled'} when MNEMO_DECISION_BOM=false", async () => {
    process.env["MNEMO_DECISION_BOM"] = "false";
    const { GET } = await import("../app/api/mnemo/decisions/[traceId]/route");
    const req = new Request("http://localhost/api/mnemo/decisions/trace_abc");
    const ctx = { params: Promise.resolve({ traceId: "trace_abc" }) };
    const res = await GET(req, ctx);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.reason).toBe("feature_disabled");
    // Must NOT have called requireAuth (kill-switch fires before auth)
    const { requireAuth } = await import("@/lib/auth-guards");
    expect(requireAuth).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid traceId format", async () => {
    process.env["MNEMO_DECISION_BOM"] = "true";
    const { GET } = await import("../app/api/mnemo/decisions/[traceId]/route");
    const req = new Request("http://localhost/api/mnemo/decisions/bad-id");
    const ctx = { params: Promise.resolve({ traceId: "bad-id" }) };
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_trace_id");
  });
});
