// packages/mnemosyne/tests/integration/entity-crud.spec.ts
//
// Mnemosyne v1.6 G2 — entity CRUD + dedup integration tests.
//
// Covers:
//   1. createEntity round-trip — values come back unmolested, arrays
//      default to [] when omitted, description is explicitly nullable.
//   2. findOrCreate dedup — repeat call returns the same row + bumps
//      mention_count + merges new aliases without duplicating.
//   3. findByAlias — exact name, lower-case name, alias array
//      membership all resolve.
//   4. updateEntity — name / aliases / canonicalId / description
//      patches round-trip; missing row returns null.
//   5. RLS — cross-workspace getEntity returns null.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let wsB: WsFixture;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;
let createEntity: typeof import("../../src/entity/store").createEntity;
let getEntity: typeof import("../../src/entity/store").getEntity;
let updateEntity: typeof import("../../src/entity/store").updateEntity;
let findByAlias: typeof import("../../src/entity/store").findByAlias;
let findOrCreate: typeof import("../../src/entity/store").findOrCreate;
let listEntities: typeof import("../../src/entity/query").listEntities;

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createEntity, getEntity, updateEntity, findByAlias, findOrCreate } =
    await import("../../src/entity/store"));
  ({ listEntities } = await import("../../src/entity/query"));
});

afterAll(() => teardownTestWorkspaces());

describe("entity/store — createEntity round-trip", () => {
  it("inserts an entity and retrieves it with all fields preserved", async () => {
    const created = await withMnemoTx(wsA.id, (tx) =>
      createEntity({
        workspaceId: wsA.id,
        name: "Lucas Mailland",
        kind: "person",
        aliases: ["@lucas", "L.M."],
        description: "ATS engineer at Fichap",
        metadata: { source: "crud-test" },
        tx,
      })
    );

    expect(created.id).toMatch(/^ment_/);
    expect(created.name).toBe("Lucas Mailland");
    expect(created.kind).toBe("person");
    expect(created.aliases.sort()).toEqual(["@lucas", "L.M."].sort());
    expect(created.description).toBe("ATS engineer at Fichap");
    expect(created.canonicalId).toBeNull();
    expect(created.mentionCount).toBe(1);

    const fetched = await withMnemoTx(wsA.id, (tx) => getEntity(wsA.id, created.id, tx));
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("Lucas Mailland");
    expect(fetched!.aliases.sort()).toEqual(["@lucas", "L.M."].sort());
  });

  it("defaults aliases to [] + description to null + metadata to {} when omitted", async () => {
    const created = await withMnemoTx(wsA.id, (tx) =>
      createEntity({
        workspaceId: wsA.id,
        name: "Minimal Project",
        kind: "project",
        tx,
      })
    );

    expect(created.aliases).toEqual([]);
    expect(created.description).toBeNull();
    expect(created.metadata).toEqual({});
  });

  it("getEntity returns null for missing ids", async () => {
    const missing = await withMnemoTx(wsA.id, (tx) => getEntity(wsA.id, "ment_does_not_exist", tx));
    expect(missing).toBeNull();
  });
});

describe("entity/store — findOrCreate idempotence", () => {
  it("returns the existing row on a repeat call (no duplicate)", async () => {
    const first = await withMnemoTx(wsA.id, (tx) =>
      findOrCreate({
        workspaceId: wsA.id,
        name: "Acme Corp.",
        kind: "organization",
        aliases: ["acme"],
        tx,
      })
    );
    const second = await withMnemoTx(wsA.id, (tx) =>
      findOrCreate({
        workspaceId: wsA.id,
        name: "Acme Corp.",
        kind: "organization",
        tx,
      })
    );
    expect(second.id).toBe(first.id);
    // mention_count bumps on each call.
    expect(second.mentionCount).toBeGreaterThanOrEqual(2);
  });

  it("merges new aliases into the existing row without duplicating", async () => {
    await withMnemoTx(wsA.id, (tx) =>
      findOrCreate({
        workspaceId: wsA.id,
        name: "Beta LLC",
        kind: "organization",
        aliases: ["beta"],
        tx,
      })
    );
    const second = await withMnemoTx(wsA.id, (tx) =>
      findOrCreate({
        workspaceId: wsA.id,
        name: "Beta LLC",
        kind: "organization",
        aliases: ["beta-llc", "beta"], // "beta" should dedup
        tx,
      })
    );
    // Both aliases present, "beta" deduped.
    expect(second.aliases.filter((a) => a === "beta").length).toBe(1);
    expect(second.aliases).toContain("beta-llc");
    expect(second.aliases).toContain("beta");
  });

  it("treats different kinds as distinct entities (same name)", async () => {
    const projectQc = await withMnemoTx(wsA.id, (tx) =>
      findOrCreate({ workspaceId: wsA.id, name: "QC", kind: "project", tx })
    );
    const personQc = await withMnemoTx(wsA.id, (tx) =>
      findOrCreate({ workspaceId: wsA.id, name: "QC", kind: "person", tx })
    );
    expect(projectQc.id).not.toBe(personQc.id);
    expect(projectQc.kind).toBe("project");
    expect(personQc.kind).toBe("person");
  });
});

describe("entity/store — findByAlias", () => {
  it("resolves by exact canonical name", async () => {
    const ent = await withMnemoTx(wsA.id, (tx) =>
      findOrCreate({
        workspaceId: wsA.id,
        name: "Sofia Garcia",
        kind: "person",
        aliases: ["@sofia"],
        tx,
      })
    );
    const found = await withMnemoTx(wsA.id, (tx) => findByAlias(wsA.id, "Sofia Garcia", tx));
    expect(found?.id).toBe(ent.id);
  });

  it("resolves by case-insensitive canonical name", async () => {
    await withMnemoTx(wsA.id, (tx) =>
      findOrCreate({ workspaceId: wsA.id, name: "Maria Rodriguez", kind: "person", tx })
    );
    const found = await withMnemoTx(wsA.id, (tx) => findByAlias(wsA.id, "maria rodriguez", tx));
    expect(found?.name).toBe("Maria Rodriguez");
  });

  it("resolves by alias array membership (case-insensitive)", async () => {
    const ent = await withMnemoTx(wsA.id, (tx) =>
      findOrCreate({
        workspaceId: wsA.id,
        name: "Daniel Smith",
        kind: "person",
        aliases: ["@dansmith"],
        tx,
      })
    );
    const upper = await withMnemoTx(wsA.id, (tx) => findByAlias(wsA.id, "@DANSMITH", tx));
    expect(upper?.id).toBe(ent.id);
  });

  it("returns null for empty input", async () => {
    const out = await withMnemoTx(wsA.id, (tx) => findByAlias(wsA.id, "  ", tx));
    expect(out).toBeNull();
  });
});

describe("entity/store — updateEntity", () => {
  it("patches name + aliases + canonicalId + description round-trip", async () => {
    const created = await withMnemoTx(wsA.id, (tx) =>
      createEntity({
        workspaceId: wsA.id,
        name: "PreRename",
        kind: "person",
        tx,
      })
    );
    const renamed = await withMnemoTx(wsA.id, (tx) =>
      updateEntity({
        workspaceId: wsA.id,
        id: created.id,
        name: "PostRename",
        aliases: ["pr", "post-rename"],
        description: "renamed for the patch test",
        tx,
      })
    );
    expect(renamed).not.toBeNull();
    expect(renamed!.name).toBe("PostRename");
    expect(renamed!.aliases.sort()).toEqual(["post-rename", "pr"]);
    expect(renamed!.description).toBe("renamed for the patch test");
  });

  it("setting canonicalId marks the row as merged into another", async () => {
    const canonical = await withMnemoTx(wsA.id, (tx) =>
      createEntity({ workspaceId: wsA.id, name: "Canonical Joe", kind: "person", tx })
    );
    const duplicate = await withMnemoTx(wsA.id, (tx) =>
      createEntity({ workspaceId: wsA.id, name: "Duplicate Joe", kind: "person", tx })
    );
    const merged = await withMnemoTx(wsA.id, (tx) =>
      updateEntity({
        workspaceId: wsA.id,
        id: duplicate.id,
        canonicalId: canonical.id,
        tx,
      })
    );
    expect(merged!.canonicalId).toBe(canonical.id);
  });

  it("returns null on missing id", async () => {
    const out = await withMnemoTx(wsA.id, (tx) =>
      updateEntity({
        workspaceId: wsA.id,
        id: "ment_does_not_exist",
        name: "ghost",
        tx,
      })
    );
    expect(out).toBeNull();
  });
});

describe("entity/query — listEntities", () => {
  it("filters by kind and q substring search", async () => {
    await withMnemoTx(wsA.id, async (tx) => {
      await createEntity({
        workspaceId: wsA.id,
        name: "ListTest Engineer One",
        kind: "person",
        tx,
      });
      await createEntity({
        workspaceId: wsA.id,
        name: "ListTest Engineer Two",
        kind: "person",
        tx,
      });
      await createEntity({
        workspaceId: wsA.id,
        name: "ListTest OrgCorp",
        kind: "organization",
        aliases: ["lt-org"],
        tx,
      });
    });

    const persons = await withMnemoTx(wsA.id, (tx) =>
      listEntities({ workspaceId: wsA.id, kind: "person", q: "ListTest", tx })
    );
    expect(persons.length).toBeGreaterThanOrEqual(2);
    expect(persons.every((e) => e.kind === "person")).toBe(true);

    // alias search
    const orgs = await withMnemoTx(wsA.id, (tx) =>
      listEntities({ workspaceId: wsA.id, q: "lt-org", tx })
    );
    expect(orgs.some((e) => e.name === "ListTest OrgCorp")).toBe(true);
  });

  it("respects limit cap", async () => {
    const out = await withMnemoTx(wsA.id, (tx) =>
      listEntities({ workspaceId: wsA.id, limit: 2, tx })
    );
    expect(out.length).toBeLessThanOrEqual(2);
  });
});

describe("entity/store — RLS cross-workspace isolation", () => {
  it("getEntity does NOT return an entity from another workspace", async () => {
    const wsBEntity = await withMnemoTx(wsB.id, (tx) =>
      createEntity({
        workspaceId: wsB.id,
        name: "wsB-only secret entity",
        kind: "person",
        tx,
      })
    );

    // We pass wsA.id as the GUC scope but the wsB entity id — the RLS
    // policy + the app workspace filter both refuse.
    const leaked = await withMnemoTx(wsA.id, (tx) => getEntity(wsA.id, wsBEntity.id, tx));
    expect(leaked).toBeNull();
  });
});
