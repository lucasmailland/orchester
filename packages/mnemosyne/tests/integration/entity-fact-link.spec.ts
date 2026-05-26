// packages/mnemosyne/tests/integration/entity-fact-link.spec.ts
//
// Mnemosyne v1.6 G2 — fact ↔ entity link round-trip + protocol_version
// tagging on newly-created facts.
//
// Covers:
//   1. createFact with entityId persists the link.
//   2. listFactsForEntity returns linked facts only (active rows).
//   3. protocol_version defaults to 'v1.1' and accepts 'v1.2' explicit.
//   4. forgotten facts are filtered out of listFactsForEntity.
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
let createFact: typeof import("../../src/primitives/fact").createFact;
let forgetFact: typeof import("../../src/primitives/fact").forgetFact;
let createEntity: typeof import("../../src/entity/store").createEntity;
let listFactsForEntity: typeof import("../../src/entity/query").listFactsForEntity;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact, forgetFact } = await import("../../src/primitives/fact"));
  ({ createEntity } = await import("../../src/entity/store"));
  ({ listFactsForEntity } = await import("../../src/entity/query"));
});

afterAll(() => teardownTestWorkspaces());

describe("fact ↔ entity link", () => {
  it("createFact persists entityId and listFactsForEntity returns the link", async () => {
    const entity = await withMnemoTx(wsA.id, (tx) =>
      createEntity({
        workspaceId: wsA.id,
        name: "Link Test Person",
        kind: "person",
        tx,
      })
    );

    const fact = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "Link Test Person",
        statement: "prefers Spanish responses when LINK_TEST_SEED present",
        entityId: entity.id,
        protocolVersion: "v1.2",
        tx,
      })
    );

    expect(fact.entityId).toBe(entity.id);
    expect(fact.protocolVersion).toBe("v1.2");

    const linked = await withMnemoTx(wsA.id, (tx) =>
      listFactsForEntity({ workspaceId: wsA.id, entityId: entity.id, tx })
    );

    const ours = linked.find((f) => f.id === fact.id);
    expect(ours).toBeTruthy();
  });

  it("listFactsForEntity excludes forgotten facts", async () => {
    const entity = await withMnemoTx(wsA.id, (tx) =>
      createEntity({
        workspaceId: wsA.id,
        name: "Forget Test Person",
        kind: "person",
        tx,
      })
    );

    const active = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "Forget Test Person",
        statement: "active fact for forget test linked to entity",
        entityId: entity.id,
        tx,
      })
    );

    const toForget = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "Forget Test Person",
        statement: "fact to be forgotten linked to entity",
        entityId: entity.id,
        tx,
      })
    );

    await withMnemoTx(wsA.id, (tx) => forgetFact(wsA.id, toForget.id, tx));

    const linked = await withMnemoTx(wsA.id, (tx) =>
      listFactsForEntity({ workspaceId: wsA.id, entityId: entity.id, tx })
    );

    expect(linked.some((f) => f.id === active.id)).toBe(true);
    expect(linked.some((f) => f.id === toForget.id)).toBe(false);
  });

  it("protocol_version defaults to v1.1 when caller omits it", async () => {
    const fact = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: "default-protocol fact for v1.1 default test",
        tx,
      })
    );

    expect(fact.protocolVersion).toBe("v1.1");
  });

  it("entityId is null by default when caller omits it", async () => {
    const fact = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: "fact without an entity link for null default test",
        tx,
      })
    );

    // entityId is `string | null | undefined` on the type — null after
    // the explicit insert.
    expect(fact.entityId ?? null).toBeNull();
  });
});
