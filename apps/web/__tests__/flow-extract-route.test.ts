import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ role: "editor" as "editor" | "viewer" }));
const svc = vi.hoisted(() => ({
  previewExtraction: vi.fn(async () => ({ ok: true, plan: { nodeIds: ["a", "b"] } })),
  extractToFlow: vi.fn(async () => ({
    plan: { nodeIds: ["a", "b"] },
    child: { id: "f2", name: "Child", kind: "action", enabled: true, nodes: [] },
    parent: { id: "f1", nodes: [] },
  })),
  serviceErrorResponse: vi.fn((e: unknown) => {
    throw e;
  }),
}));

vi.mock("@/lib/auth-guards", () => ({
  requireAuth: async ({ minRole }: { minRole?: string } = {}) =>
    minRole === "editor" && auth.role !== "editor"
      ? Response.json({ error: "Forbidden" }, { status: 403 })
      : { workspace: { id: "ws_test" }, user: { id: "user_test" } },
  isAuthContext: (x: unknown) => !(x instanceof Response),
}));
vi.mock("@/lib/flows/service", () => svc);

const { POST } = await import("@/app/api/flows/[id]/extract/route");

const post = (body: unknown) =>
  POST(
    new Request("https://example.com/api/flows/f1/extract", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "f1" }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "editor";
});

describe("POST /api/flows/[id]/extract", () => {
  it("previews without extracting", async () => {
    const r = await post({ groupId: "g1", preview: true });
    expect(r.status).toBe(200);
    expect(svc.previewExtraction).toHaveBeenCalledWith(
      { kind: "user", workspaceId: "ws_test", userId: "user_test" },
      "f1",
      { groupId: "g1" }
    );
    expect(svc.extractToFlow).not.toHaveBeenCalled();
  });

  it("extracts, scoped to the caller's workspace, and returns the new flow", async () => {
    const r = await post({ nodeIds: ["a", "b"], name: "Child", icon: "Globe" });
    expect(r.status).toBe(201);
    expect(svc.extractToFlow).toHaveBeenCalledWith(
      { kind: "user", workspaceId: "ws_test", userId: "user_test" },
      "f1",
      { nodeIds: ["a", "b"], name: "Child", icon: "Globe" }
    );
    const body = await r.json();
    expect(body.child).toEqual({ id: "f2", name: "Child", kind: "action", enabled: true });
  });

  it("requires the editor role", async () => {
    auth.role = "viewer";
    expect((await post({ groupId: "g1" })).status).toBe(403);
    expect(svc.extractToFlow).not.toHaveBeenCalled();
  });

  it.each([
    ["neither a group nor steps", {}],
    ["both a group and steps", { groupId: "g1", nodeIds: ["a"] }],
    ["an unknown icon", { groupId: "g1", icon: "Rocket" }],
    ["a two-line description", { groupId: "g1", description: "a\nb" }],
    ["an unknown field", { groupId: "g1", force: true }],
  ])("rejects %s", async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(svc.extractToFlow).not.toHaveBeenCalled();
    expect(svc.previewExtraction).not.toHaveBeenCalled();
  });
});
