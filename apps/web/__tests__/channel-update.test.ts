import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ set: vi.fn(), returning: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: async () => ({ workspace: { id: "workspace_test" }, user: { id: "user_test" } }),
  isAuthContext: () => true,
}));
vi.mock("@/lib/workspace", () => ({ getCurrentWorkspace: vi.fn() }));
vi.mock("@/lib/encryption", () => ({ encrypt: vi.fn() }));
vi.mock("@/lib/channels/telegram", () => ({ telegramSetWebhook: vi.fn(), telegramGetMe: vi.fn() }));
vi.mock("@/lib/channels/slack", () => ({ slackAuthTest: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@orchester/db", () => ({
  getDb: () => ({ update: () => ({ set: mocks.set }) }),
  schema: { channels: { id: "id", workspaceId: "workspaceId", config: "config" } },
}));
const { PATCH } = await import("@/app/api/channels/[id]/route");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.set.mockReturnValue({ where: () => ({ returning: mocks.returning }) });
  mocks.returning.mockResolvedValue([
    { id: "channel_test", type: "telegram", credentialsEncrypted: null },
  ]);
});
function patch(body: unknown) {
  return PATCH(
    new Request("https://example.com", { method: "PATCH", body: JSON.stringify(body) }),
    {
      params: Promise.resolve({ id: "channel_test" }),
    }
  );
}
it.each(
  [null, "1234567", [""], [" "], [1234567], Array(201).fill("test"), ["x".repeat(257)]].map(
    (allowedSenders) => ({ allowedSenders })
  )
)("rejects invalid nested allowlist %j", async ({ allowedSenders }) => {
  expect((await patch({ config: { allowedSenders } })).status).toBe(400);
  expect(mocks.set).not.toHaveBeenCalled();
});
it.each([[], ["1234567"], Array(200).fill("test")].map((allowedSenders) => ({ allowedSenders })))(
  "accepts allowlist %j",
  async ({ allowedSenders }) => {
    expect((await patch({ config: { allowedSenders } })).status).toBe(200);
    expect(mocks.set).toHaveBeenCalledOnce();
  }
);

it("merges config atomically and trims sender entries", async () => {
  await patch({ config: { allowedSenders: [" 1234567 "] } });
  const query = new PgDialect().sqlToQuery(mocks.set.mock.calls[0]![0].config);
  expect(query.sql).toContain("coalesce(");
  expect(query.sql).toContain("||");
  expect(query.params).toContain(JSON.stringify({ allowedSenders: ["1234567"] }));
});

it("does not clear the allowlist when updating other channel fields", async () => {
  await patch({ status: "inactive" });
  expect(mocks.set.mock.calls[0]![0]).not.toHaveProperty("config");
  await patch({ config: { greeting: "Test greeting" } });
  const query = new PgDialect().sqlToQuery(mocks.set.mock.calls[1]![0].config);
  expect(query.sql).toContain("||");
  expect(query.params).toContain(JSON.stringify({ greeting: "Test greeting" }));
});
