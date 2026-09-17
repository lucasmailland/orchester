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

it("exports a shared structured chain-rotation warning", async () => {
  const warn = vi
    .spyOn(await import("../lib/safe-log"), "safeLogWarn")
    .mockImplementation(() => {});
  try {
    const log = await import("../lib/audit/log");
    expect(log).toHaveProperty("warnChainRotated", expect.any(Function));
    await log.warnChainRotated("ws_test", BigInt(2));
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[audit] chain rotated past legacy bootstrap row:",
      {
        level: "warn",
        msg: "audit.chain.rotated_past_legacy_bootstrap",
        workspaceId: "ws_test",
        seq: "2",
      }
    );
  } finally {
    warn.mockRestore();
  }
});
