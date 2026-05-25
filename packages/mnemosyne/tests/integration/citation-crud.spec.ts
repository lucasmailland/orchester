import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let createCitation: typeof import("../../src/citation/store").createCitation;
let listCitationsForMemory: typeof import("../../src/citation/store").listCitationsForMemory;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ createCitation, listCitationsForMemory } = await import("../../src/citation/store"));
  ({ withMnemoTx } = await import("../../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

describe("citation/store", () => {
  it("creates a citation and retrieves it", async () => {
    const c = await withMnemoTx(wsA.id, (tx) =>
      createCitation({
        workspaceId: wsA.id,
        memoryKind: "fact",
        memoryId: "mfact_test",
        sourceKind: "message",
        sourceId: "msg_xyz",
        extractorModel: "<workspace.small_model>",
        extractorPromptVersion: "v1",
        evidenceExcerpt: "user prefers Spanish",
        tx,
      })
    );
    expect(c.id).toMatch(/^mcit_/);

    const list = await withMnemoTx(wsA.id, (tx) =>
      listCitationsForMemory(wsA.id, "fact", "mfact_test", tx)
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.evidenceExcerpt).toBe("user prefers Spanish");
  });
});
