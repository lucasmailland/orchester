import { beforeEach, describe, expect, it, vi } from "vitest";

const svc = vi.hoisted(() => ({
  createFlow: vi.fn(async () => ({ flow: { id: "f1" }, warnings: [] })),
  updateFlow: vi.fn(async () => ({ flow: { id: "f1" }, warnings: [] })),
  getFlow: vi.fn(),
  listFlows: vi.fn(async () => []),
  serviceErrorResponse: vi.fn(),
}));

vi.mock("@/lib/auth-guards", () => ({
  requireAuth: async () => ({ workspace: { id: "ws_test" }, user: { id: "user_test" } }),
  isAuthContext: () => true,
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/workspace", () => ({}));
vi.mock("@/lib/flows/service", () => svc);
vi.mock("@orchester/db", () => ({ schema: {}, getDb: () => ({}) }));

const { POST } = await import("@/app/api/flows/route");
const { PATCH } = await import("@/app/api/flows/[id]/route");

const post = (body: unknown) =>
  POST(
    new Request("https://example.com/api/flows", { method: "POST", body: JSON.stringify(body) })
  );
const patch = (body: unknown) =>
  PATCH(
    new Request("https://example.com/api/flows/f1", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "f1" }) }
  );

beforeEach(() => vi.clearAllMocks());

describe("flow kind over REST", () => {
  it("POST accepts kind and externalCallers", async () => {
    const r = await post({ name: "Act", kind: "action", externalCallers: [{ name: "cron" }] });
    expect(r.status).toBe(201);
    expect(svc.createFlow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "action", externalCallers: [{ name: "cron" }] })
    );
  });

  it("PATCH accepts kind and externalCallers, including a clear", async () => {
    expect((await patch({ kind: "pipeline", externalCallers: [] })).status).toBe(200);
    expect(svc.updateFlow).toHaveBeenCalledWith(
      expect.anything(),
      "f1",
      expect.objectContaining({ kind: "pipeline", externalCallers: [] })
    );
  });

  it.each([
    ["kind", "macro"],
    ["externalCallers", [{ name: "" }]],
    ["externalCallers", [{ name: "a".repeat(81) }]],
    ["externalCallers", [{ name: "a", note: "n".repeat(201) }]],
    ["externalCallers", Array.from({ length: 11 }, (_, i) => ({ name: `c${i}` }))],
  ])("rejects invalid %s (%j) on POST and PATCH", async (field, value) => {
    expect((await post({ name: "x", [field]: value })).status).toBe(400);
    expect((await patch({ [field]: value })).status).toBe(400);
    expect(svc.createFlow).not.toHaveBeenCalled();
    expect(svc.updateFlow).not.toHaveBeenCalled();
  });
});
