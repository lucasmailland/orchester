import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

describe("withMnemoTx", () => {
  it("sets app.workspace_id GUC and runs callback in transaction", async () => {
    const result = await withMnemoTx(wsA.id, async (tx) => {
      const rows = await tx.execute(`SELECT current_setting('app.workspace_id', true) AS ws`);
      return (rows as unknown as Array<{ ws: string }>)[0]!.ws;
    });
    expect(result).toBe(wsA.id);
  });
});
