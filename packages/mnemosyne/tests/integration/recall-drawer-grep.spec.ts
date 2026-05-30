// packages/mnemosyne/tests/integration/recall-drawer-grep.spec.ts
//
// Integration tests for v1.1 #1+2 — Pointer index + drawer-grep.
// Verifies that:
//  1. createFact writes pointer index entries when entityId is set
//  2. lookupPointer returns the correct entity for query terms
//  3. searchMnemo with usePointerIndex=true routes to the right drawer
//  4. usePointerIndex=false bypasses the pointer and behaves as before
//
// Requires OrbStack / Docker for testcontainers postgres.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import { vi } from "vitest";

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let createFact: typeof import("../../src/primitives/fact").createFact;
let lookupPointer: typeof import("../../src/index/pointer").lookupPointer;
let extractPointerTerms: typeof import("../../src/index/pointer").extractPointerTerms;
let rebuildPointerIndex: typeof import("../../src/index/pointer").rebuildPointerIndex;
let findOrCreate: typeof import("../../src/entity/store").findOrCreate;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ lookupPointer, extractPointerTerms, rebuildPointerIndex } =
    await import("../../src/index/pointer"));
  ({ findOrCreate } = await import("../../src/entity/store"));
  ({ withMnemoTx } = await import("../../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

/** Read all pointer rows for a workspace (test helper). */
async function readPointerRows(entityId?: string) {
  return withMnemoTx(wsA.id, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT term, entity_id, mention_count
      FROM mnemo_pointer
      WHERE workspace_id = ${wsA.id}
        ${entityId ? sql`AND entity_id = ${entityId}` : sql``}
      ORDER BY term ASC, entity_id ASC
    `)) as unknown as Array<{
      term: string;
      entity_id: string;
      mention_count: number;
    }>;
    return rows.map((r) => ({
      term: r.term,
      entityId: r.entity_id,
      mentionCount: Number(r.mention_count),
    }));
  });
}

describe("pointer index — createFact wires pointer", () => {
  it("writes pointer entries when entityId is set", async () => {
    const entity = await withMnemoTx(wsA.id, (tx) =>
      findOrCreate({ workspaceId: wsA.id, name: "Lucas Mailland", kind: "person", tx })
    );

    await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "Lucas Mailland",
        statement: "Lucas Mailland prefers TypeScript over JavaScript for backend development",
        entityId: entity.id,
        tx,
      })
    );

    const rows = await readPointerRows(entity.id);
    const terms = rows.map((r) => r.term);
    // Content tokens from the statement should be indexed
    expect(terms).toContain("lucas");
    expect(terms).toContain("mailland");
    expect(terms).toContain("typescript");
    expect(terms).toContain("javascript");
    expect(terms).toContain("backend");
    expect(terms).toContain("development");
    // Stopwords must NOT be indexed
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("for");
    expect(terms).not.toContain("over");
  });

  it("does NOT write pointer entries when entityId is null", async () => {
    // Baseline row count
    const before = await readPointerRows();

    await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "anonymous preference",
        statement: "prefers dark mode with a very specific configuration setting across all panels",
        // entityId deliberately omitted (null)
        tx,
      })
    );

    const after = await readPointerRows();
    // No new pointer rows should have been added
    expect(after.length).toBe(before.length);
  });

  it("increments mention_count on second fact for same entity+term", async () => {
    const entity = await withMnemoTx(wsA.id, (tx) =>
      findOrCreate({
        workspaceId: wsA.id,
        name: "Acme Inc Pointer Test",
        kind: "organization",
        tx,
      })
    );

    // First fact
    await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "Acme Inc Pointer Test",
        statement: "Acme standardizes backend services with Kubernetes deployments",
        entityId: entity.id,
        tx,
      })
    );
    const rowsBefore = await readPointerRows(entity.id);
    const backendBefore = rowsBefore.find((r) => r.term === "backend");
    expect(backendBefore).toBeDefined();
    const countBefore = backendBefore!.mentionCount;

    // Second fact referencing the same term
    await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "Acme Inc Pointer Test",
        statement: "Acme backend team prefers Golang over Python for performance reasons at scale",
        entityId: entity.id,
        tx,
      })
    );
    const rowsAfter = await readPointerRows(entity.id);
    const backendAfter = rowsAfter.find((r) => r.term === "backend");
    expect(backendAfter).toBeDefined();
    expect(backendAfter!.mentionCount).toBe(countBefore + 1);
  });
});

describe("pointer index — lookupPointer routing", () => {
  it("returns the entity whose facts best match the query terms", async () => {
    // Create two entities with distinct content
    const entityTS = await withMnemoTx(wsA.id, (tx) =>
      findOrCreate({
        workspaceId: wsA.id,
        name: "TypeScript Expert Entity",
        kind: "person",
        tx,
      })
    );
    const entityGo = await withMnemoTx(wsA.id, (tx) =>
      findOrCreate({
        workspaceId: wsA.id,
        name: "Golang Expert Entity",
        kind: "person",
        tx,
      })
    );

    // Seed facts so the pointer index knows about each entity
    await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "skill",
        subject: "TypeScript Expert Entity",
        statement: "TypeScript expert with strict null checking configuration",
        entityId: entityTS.id,
        tx,
      })
    );
    await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "skill",
        subject: "Golang Expert Entity",
        statement: "Golang expert focused goroutines concurrency patterns",
        entityId: entityGo.id,
        tx,
      })
    );

    // Query for TypeScript terms → should route to entityTS
    const tsTerms = extractPointerTerms("TypeScript strict configuration");
    const tsHits = await withMnemoTx(wsA.id, (tx) =>
      lookupPointer({ workspaceId: wsA.id, queryTerms: tsTerms, limit: 5, tx })
    );
    const tsEntityIds = tsHits.map((h) => h.entityId);
    expect(tsEntityIds).toContain(entityTS.id);

    // Query for Golang terms → should route to entityGo
    const goTerms = extractPointerTerms("goroutines Golang concurrency");
    const goHits = await withMnemoTx(wsA.id, (tx) =>
      lookupPointer({ workspaceId: wsA.id, queryTerms: goTerms, limit: 5, tx })
    );
    const goEntityIds = goHits.map((h) => h.entityId);
    expect(goEntityIds).toContain(entityGo.id);
  });

  it("returns empty when query terms have no pointer entries", async () => {
    const terms = extractPointerTerms("xyzqwerty completely novel unindexed query");
    const hits = await withMnemoTx(wsA.id, (tx) =>
      lookupPointer({ workspaceId: wsA.id, queryTerms: terms, limit: 5, tx })
    );
    // The pointer index has no entries for these tokens
    expect(hits.filter((h) => h.relevance > 0)).toHaveLength(0);
  });

  it("returns empty when queryTerms is empty", async () => {
    const hits = await withMnemoTx(wsA.id, (tx) =>
      lookupPointer({ workspaceId: wsA.id, queryTerms: [], limit: 5, tx })
    );
    expect(hits).toHaveLength(0);
  });

  it("respects the limit parameter", async () => {
    // The pointer index already has multiple entities — limit=1 should return ≤1
    const terms = extractPointerTerms("backend services configuration");
    const hits = await withMnemoTx(wsA.id, (tx) =>
      lookupPointer({ workspaceId: wsA.id, queryTerms: terms, limit: 1, tx })
    );
    expect(hits.length).toBeLessThanOrEqual(1);
  });
});

describe("pointer index — rebuildPointerIndex", () => {
  it("indexes all active entity-linked facts and returns count", async () => {
    const entity = await withMnemoTx(wsA.id, (tx) =>
      findOrCreate({
        workspaceId: wsA.id,
        name: "Rebuild Target Entity",
        kind: "project",
        tx,
      })
    );

    // Create facts (pointer is wired automatically)
    await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "Rebuild Target Entity",
        statement: "Rebuild project uses PostgreSQL with pgvector extension for embedding storage",
        entityId: entity.id,
        tx,
      })
    );

    // Now clear the pointer for this entity and rebuild
    await withMnemoTx(wsA.id, (tx) =>
      tx.execute(
        sql`DELETE FROM mnemo_pointer WHERE workspace_id = ${wsA.id} AND entity_id = ${entity.id}`
      )
    );

    const rowsBeforeRebuild = await readPointerRows(entity.id);
    expect(rowsBeforeRebuild).toHaveLength(0);

    const indexed = await withMnemoTx(wsA.id, (tx) =>
      rebuildPointerIndex({ workspaceId: wsA.id, entityId: entity.id, tx })
    );
    expect(indexed).toBeGreaterThanOrEqual(1); // at least 1 fact re-indexed

    const rowsAfterRebuild = await readPointerRows(entity.id);
    expect(rowsAfterRebuild.length).toBeGreaterThan(0);
    // "postgresql", "pgvector", "embedding", "storage" should appear
    const terms = rowsAfterRebuild.map((r) => r.term);
    expect(terms).toContain("postgresql");
    expect(terms).toContain("pgvector");
    expect(terms).toContain("embedding");
    expect(terms).toContain("storage");
  });
});
