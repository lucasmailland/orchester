import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let createDecision: typeof import("../../src/primitives/decision").createDecision;
let getDecision: typeof import("../../src/primitives/decision").getDecision;
let supersedeDecision: typeof import("../../src/primitives/decision").supersedeDecision;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ createDecision, getDecision, supersedeDecision } =
    await import("../../src/primitives/decision"));
  ({ withMnemoTx } = await import("../../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

describe("primitives/decision", () => {
  it("creates a decision with topic_key", async () => {
    const d = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "architecture",
        title: "Auth model: JWT",
        body: "Use JWT instead of session cookies",
        topicKey: "auth/model",
        tx,
      })
    );
    expect(d.id).toMatch(/^mdec_/);
    expect(d.revisionCount).toBe(1);
    expect(d.kind).toBe("architecture");
    expect(d.topicKey).toBe("auth/model");
  });

  it("upserts on duplicate topic_key (increments revision_count)", async () => {
    const d1 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Refund window",
        body: "30 days",
        topicKey: "billing/refund-policy",
        tx,
      })
    );
    const d2 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Refund window",
        body: "60 days for premium",
        topicKey: "billing/refund-policy",
        tx,
      })
    );
    expect(d2.id).toBe(d1.id); // same row
    expect(d2.revisionCount).toBe(2);
    expect(d2.body).toBe("60 days for premium");
  });

  it("getDecision retrieves a saved decision", async () => {
    const created = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "learning",
        title: "Test learning",
        body: "Discovered something",
        tx,
      })
    );
    const fetched = await withMnemoTx(wsA.id, (tx) => getDecision(wsA.id, created.id, tx));
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.title).toBe("Test learning");
  });

  it("supersedeDecision marks status='superseded' and sets supersededById", async () => {
    const oldD = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "decision",
        title: "Old way",
        body: "Way A",
        tx,
      })
    );
    const newD = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "decision",
        title: "New way",
        body: "Way B",
        tx,
      })
    );
    await withMnemoTx(wsA.id, (tx) => supersedeDecision(wsA.id, oldD.id, newD.id, tx));
    const fetched = await withMnemoTx(wsA.id, (tx) => getDecision(wsA.id, oldD.id, tx));
    expect(fetched?.status).toBe("superseded");
    expect(fetched?.supersededById).toBe(newD.id);
  });
});
