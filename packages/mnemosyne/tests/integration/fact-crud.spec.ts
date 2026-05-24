import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let createFact: typeof import("../../src/primitives/fact").createFact;
let getFact: typeof import("../../src/primitives/fact").getFact;
let forgetFact: typeof import("../../src/primitives/fact").forgetFact;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ createFact, getFact, forgetFact } = await import("../../src/primitives/fact"));
  ({ withMnemoTx } = await import("../../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

describe("primitives/fact", () => {
  it("creates a fact and retrieves it", async () => {
    const f = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "prefers Spanish responses",
        tx,
      })
    );
    expect(f.id).toMatch(/^mfact_/);
    const g = await withMnemoTx(wsA.id, (tx) => getFact(wsA.id, f.id, tx));
    expect(g?.statement).toBe("prefers Spanish responses");
  });

  it("forgetFact sets status='forgotten'", async () => {
    const f = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "event",
        subject: "u",
        statement: "a forgettable test event for unit testing",
        tx,
      })
    );
    await withMnemoTx(wsA.id, (tx) => forgetFact(wsA.id, f.id, tx));
    const g = await withMnemoTx(wsA.id, (tx) => getFact(wsA.id, f.id, tx));
    expect(g?.status).toBe("forgotten");
  });
});
