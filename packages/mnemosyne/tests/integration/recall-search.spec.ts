// packages/mnemosyne/tests/integration/recall-search.spec.ts
//
// Integration tests for searchMnemo — exercises the Mode A FTS path
// against a real Postgres + the migrated mnemo_fact schema.
//
// We do not test Mode B/C here: that requires injecting an `embedFn` and
// pgvector data, which is covered by host-level tests in apps/web. The
// Mode A path is the one that ships in the minimal "no provider keys"
// deployment, so it gets the canonical isolation + ranking coverage.
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
let createFact: typeof import("../../src/primitives/fact").createFact;
let searchMnemo: typeof import("../../src/recall/search").searchMnemo;

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ searchMnemo } = await import("../../src/recall/search"));
});

afterAll(() => teardownTestWorkspaces());

describe("recall/search — Mode A FTS path", () => {
  it("ranks lexically-matching facts above non-matching ones", async () => {
    // Seed three facts in workspace A. Only one mentions "espresso".
    await withMnemoTx(wsA.id, async (tx) => {
      await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "prefers espresso over filter coffee in the morning",
        tx,
      });
      await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "prefers responses in Spanish for billing topics",
        tx,
      });
      await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: "based in Buenos Aires and works in Pacific timezone",
        tx,
      });
    });

    // No embedding* fields → Mode A FTS path.
    // `searchMnemo` opens its own workspace tx when none is provided.
    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "espresso",
      topK: 5,
    });

    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.fact.statement).toContain("espresso");
    // Score is composed of fts + recency + frequency + pin — all
    // non-negative — so the top hit's score must be > 0.
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it("does not return facts from a different workspace (RLS isolation)", async () => {
    // Seed a wsB fact that lexically matches a unique token.
    await withMnemoTx(wsB.id, (tx) =>
      createFact({
        workspaceId: wsB.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "prefers Klingon documentation for klingon-only configs",
        tx,
      })
    );

    // Search in wsA's context — wsB's klingon fact must not appear.
    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "klingon",
      topK: 10,
    });

    for (const h of hits) {
      expect(h.fact.workspaceId).toBe(wsA.id);
      expect(h.fact.statement.toLowerCase()).not.toContain("klingon");
    }
  });

  it("returns [] when no fact matches the query (Mode A)", async () => {
    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "zzz_xyzzy_nonexistent_token_pancakes",
      topK: 5,
    });
    expect(hits).toEqual([]);
  });
});
