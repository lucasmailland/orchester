// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { select: vi.fn(), update: vi.fn() },
  invalidate: vi.fn(),
  test: vi.fn(),
}));
vi.mock("@orchester/db", () => ({
  getDb: () => mocks.db,
  schema: {
    workspaceIntegrations: Object.fromEntries(
      [
        "id",
        "workspaceId",
        "type",
        "name",
        "meta",
        "enabled",
        "status",
        "lastTestedAt",
        "lastError",
        "createdAt",
      ].map((k) => [k, k])
    ),
  },
}));
vi.mock("@/lib/integrations/mcp-client", () => ({
  testMcpConnection: mocks.test,
  invalidateMcpTools: mocks.invalidate,
}));
vi.mock("@/lib/workspace", () => ({
  getCurrentWorkspace: async () => ({ workspace: { id: "workspace-test" } }),
}));
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: async () => ({ workspace: { id: "workspace-test" }, user: { id: "user-test" } }),
  isAuthContext: () => true,
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
import { encrypt, decrypt } from "@/lib/encryption";
import { getConnector } from "@/lib/integrations/registry";
import { GET } from "@/app/api/integrations/route";
import { PATCH } from "@/app/api/integrations/[id]/route";
const config = { url: "https://mcp.example.com/mcp", authHeader: "Bearer test-secret" };
let stored: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ENCRYPTION_SECRET", "11".repeat(32));
  vi.stubEnv("ENCRYPTION_KEYS", "");
  stored = {
    id: "integration-test",
    workspaceId: "workspace-test",
    type: "mcp",
    name: "Documents",
    configEncrypted: encrypt(JSON.stringify(config)),
    meta: {},
    enabled: true,
    status: "connected",
  };
  mocks.db.select.mockImplementation((projection?: Record<string, unknown>) => {
    const row = projection
      ? Object.fromEntries(Object.keys(projection).map((k) => [k, stored[k]]))
      : stored;
    return { from: () => ({ where: () => Promise.resolve([row]) }) };
  });
  mocks.db.update.mockReturnValue({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        Object.assign(stored, values);
      },
    }),
  });
  mocks.test.mockResolvedValue({ ok: true, meta: { toolCount: 1 } });
});
afterEach(() => vi.unstubAllEnvs());
describe("MCP integration API", () => {
  it("registers URL, secret, allowlist and timeout fields and tests the official client", async () => {
    const connector = getConnector("mcp");
    expect(connector).toBeDefined();
    expect(connector!.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "authHeader", type: "password" }),
        expect.objectContaining({ key: "toolAllowlist" }),
        expect.objectContaining({ key: "timeoutMs" }),
      ])
    );
    await connector!.test(config);
    expect(mocks.test).toHaveBeenCalledWith(config);
  });
  it("never returns configuration or ciphertext from GET", async () => {
    const response = await GET();
    const json = await response.json();
    expect(json.configured[0]).toMatchObject({ id: "integration-test", type: "mcp" });
    expect(JSON.stringify(json)).not.toContain(config.authHeader);
    expect(json.configured[0]).not.toHaveProperty("configEncrypted");
    expect(json.configured[0]).not.toHaveProperty("config");
  });
  it("encrypts updated auth headers, omits secrets in PATCH and invalidates the tools cache", async () => {
    const response = await PATCH(
      new Request("https://example.com/api/integrations/integration-test", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "mcp", name: "Documents", config }),
      }),
      { params: Promise.resolve({ id: "integration-test" }) }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "integration-test",
      status: "connected",
      meta: { toolCount: 1 },
    });
    expect(stored.configEncrypted).not.toContain(config.authHeader);
    expect(JSON.parse(decrypt(stored.configEncrypted as string))).toEqual(config);
    expect(mocks.invalidate).toHaveBeenCalledWith("workspace-test", "integration-test");
  });
});
