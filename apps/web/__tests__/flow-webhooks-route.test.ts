import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: async () => ({ workspace: { id: "ws_test" }, user: { id: "user_test" } }),
  isAuthContext: () => true,
}));
vi.mock("@/lib/flows/flow-repo", () => ({}));
vi.mock("@/lib/audit", () => ({}));
vi.mock("@/lib/billing/quotas", () => ({}));
vi.mock("@/lib/flows/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/flows/service")>()),
  listFlowWebhooks: mocks.list,
  createFlowWebhook: mocks.create,
}));
const { FlowServiceError } = await import("@/lib/flows/service");
const { GET, POST } = await import("@/app/api/flows/[id]/webhooks/route");
beforeEach(() => vi.clearAllMocks());

it.each(["unknown_test", "foreign_test"])("GET returns an empty array for %s", async (id) => {
  mocks.list.mockRejectedValue(new FlowServiceError("not_found", "Flow not found"));
  const response = await GET(new Request("https://example.com"), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([]);
});

it("POST keeps the ownership-check 404", async () => {
  mocks.create.mockRejectedValue(new FlowServiceError("not_found", "Flow not found"));
  const response = await POST(
    new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    { params: Promise.resolve({ id: "foreign_test" }) }
  );
  expect(response.status).toBe(404);
});

it("GET still propagates unexpected failures", async () => {
  mocks.list.mockRejectedValue(new Error("database unavailable"));
  await expect(
    GET(new Request("https://example.com"), {
      params: Promise.resolve({ id: "flow_test" }),
    })
  ).rejects.toThrow("database unavailable");
});
