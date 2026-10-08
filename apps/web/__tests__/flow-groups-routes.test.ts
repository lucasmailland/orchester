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

const group = {
  id: "g1",
  name: "Fetch monitoring data",
  description: "Reads the alert and its context",
  icon: "Globe",
  nodeIds: ["a", "b"],
};

beforeEach(() => vi.clearAllMocks());

describe("step groups over REST", () => {
  it("POST and PATCH pass groups to the service", async () => {
    expect((await post({ name: "x", groups: [group] })).status).toBe(201);
    expect(svc.createFlow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ groups: [group] })
    );
    expect((await patch({ groups: [group] })).status).toBe(200);
    expect(svc.updateFlow).toHaveBeenCalledWith(
      expect.anything(),
      "f1",
      expect.objectContaining({ groups: [group] })
    );
  });

  it("PATCH can clear the groups", async () => {
    expect((await patch({ groups: [] })).status).toBe(200);
    expect(svc.updateFlow).toHaveBeenCalledWith(
      expect.anything(),
      "f1",
      expect.objectContaining({ groups: [] })
    );
  });

  it.each([
    ["no name", { ...group, name: "" }],
    ["a long name", { ...group, name: "n".repeat(61) }],
    ["a two-line description", { ...group, description: "a\nb" }],
    ["an unknown icon", { ...group, icon: "Rocket" }],
    ["one step", { ...group, nodeIds: ["a"] }],
  ])("rejects a group with %s on POST and PATCH", async (_label, bad) => {
    expect((await post({ name: "x", groups: [bad] })).status).toBe(400);
    expect((await patch({ groups: [bad] })).status).toBe(400);
    expect(svc.createFlow).not.toHaveBeenCalled();
    expect(svc.updateFlow).not.toHaveBeenCalled();
  });
});
