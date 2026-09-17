// apps/web/__tests__/audit-in-tx.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@orchester/db", () => ({
  getDb: vi.fn(() => {
    throw new Error("appendAuditInTx must not open its own transaction");
  }),
  schema: { auditLog: { seq: "seq", chainHash: "chain_hash", workspaceId: "workspace_id" } },
}));

describe("appendAuditInTx", () => {
  it("writes through the given transaction", async () => {
    const inserted: Record<string, unknown>[] = [];
    const tx = {
      execute: vi.fn(async () => ({ rows: [] })),
      select: () => tx,
      from: () => tx,
      where: () => tx,
      orderBy: () => tx,
      limit: async () => [],
      insert: () => ({ values: async (row: Record<string, unknown>) => void inserted.push(row) }),
    };
    const { appendAuditInTx } = await import("../lib/audit/log");
    await appendAuditInTx(tx as never, "ws_test", {
      action: "flow.update",
      actorUserId: null,
      actorKind: "api_key",
      targetType: "flow",
      targetId: "flow_1",
      meta: { apiKeyId: "key_1" },
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      actorKind: "api_key",
      actorUserId: null,
      meta: { apiKeyId: "key_1" },
      seq: BigInt(1),
    });
    expect(tx.execute).toHaveBeenCalled();
  });
});
