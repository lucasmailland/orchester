import { it, expect, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/encryption", () => ({ encrypt: (s: string) => s, decrypt: (s: string) => s }));

// Mutable row so individual tests can control the status returned by the DB mock.
const mockRow = {
  id: "i1",
  type: "stripe",
  name: "S",
  configEncrypted: "{}",
  status: "error",
  enabled: true,
};
vi.mock("@orchester/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => [mockRow] }),
      }),
    }),
  }),
  schema: { workspaceIntegrations: {} },
}));
afterEach(() => vi.restoreAllMocks());

it("runIntegrationAction refuses to run when status !== connected", async () => {
  mockRow.status = "error";
  const store = await import("@/lib/integrations/store");
  await expect(store.runIntegrationAction("ws", "i1", "get_balance", {})).rejects.toThrow(
    /no está conectada|not connected/i
  );
});

it("runIntegrationAction proceeds past status gate when connected (fails on unknown connector, not status)", async () => {
  mockRow.status = "connected";
  // Use a type that doesn't exist in the registry so we get "Connector desconocido"
  mockRow.type = "nonexistent_xyz";
  const store = await import("@/lib/integrations/store");
  await expect(store.runIntegrationAction("ws", "i1", "any_action", {})).rejects.toThrow(
    /Connector desconocido|unknown connector/i
  );
});
