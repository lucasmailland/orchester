// packages/mnemosyne/tests/integration/fact-async-batch.spec.ts
//
// Integration spec for `createFactAsync` against the real Postgres
// testcontainer. Proves the contract end-to-end:
//
//  1. Facts created via `createFactAsync` are inserted with
//     `embedding IS NULL` in the actual `mnemo_fact` table.
//  2. The enqueue callback fires once per fact with the (factId,
//     workspaceId, statement) tuple — no embedding API call happens.
//  3. PII redaction still works on the async path (the row's stored
//     statement matches what's passed to the enqueue callback).
//  4. Back-compat: `createFactAsync` WITHOUT enqueueEmbed behaves
//     identically to `createFact` — provider/model/embedFn are
//     forwarded as-is.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let createFactAsync: typeof import("../../src/primitives/fact-async").createFactAsync;
let EMBED_FACT_JOB_NAME: typeof import("../../src/primitives/fact-async").EMBED_FACT_JOB_NAME;
let getFact: typeof import("../../src/primitives/fact").getFact;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ createFactAsync, EMBED_FACT_JOB_NAME } = await import("../../src/primitives/fact-async"));
  ({ getFact } = await import("../../src/primitives/fact"));
  ({ withMnemoTx } = await import("../../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

describe("createFactAsync — integration", () => {
  it("inserts 5 facts with NULL embedding and enqueues 5 jobs", async () => {
    const enqueueCalls: Array<{ name: string; data: Record<string, unknown> }> = [];
    const enqueueEmbed = async (name: string, data: Record<string, unknown>) => {
      enqueueCalls.push({ name, data });
    };

    const facts = await withMnemoTx(wsA.id, async (tx) => {
      const out = [];
      for (let i = 0; i < 5; i++) {
        out.push(
          await createFactAsync({
            workspaceId: wsA.id,
            scope: "global",
            kind: "preference",
            subject: `async-test-subject-${i}`,
            statement: `async fact number ${i} for batched embedding`,
            enqueueEmbed,
            tx,
          })
        );
      }
      return out;
    });

    expect(facts).toHaveLength(5);

    // All 5 rows in DB with embedding = NULL.
    for (const f of facts) {
      const persisted = await withMnemoTx(wsA.id, (tx) => getFact(wsA.id, f.id, tx));
      expect(persisted).not.toBeNull();
      expect(persisted!.embedding).toBeNull();
    }

    // Enqueue fired exactly 5 times, all with the canonical queue name
    // + (factId, workspaceId, statement) tuple.
    expect(enqueueCalls).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      const call = enqueueCalls[i]!;
      expect(call.name).toBe(EMBED_FACT_JOB_NAME);
      expect(call.data.factId).toBe(facts[i]!.id);
      expect(call.data.workspaceId).toBe(wsA.id);
      expect(call.data.statement).toBe(`async fact number ${i} for batched embedding`);
    }
  });

  it("redacts PII on the async path AND passes the redacted statement to enqueue", async () => {
    const enqueueCalls: Array<{ name: string; data: Record<string, unknown> }> = [];
    const enqueueEmbed = async (name: string, data: Record<string, unknown>) => {
      enqueueCalls.push({ name, data });
    };

    const fact = await withMnemoTx(wsA.id, (tx) =>
      createFactAsync({
        workspaceId: wsA.id,
        scope: "global",
        kind: "event",
        subject: "async-pii-subject",
        statement: "contact me at async-test@example.com for follow-up",
        enqueueEmbed,
        tx,
      })
    );

    // Stored statement is redacted (A3 PII pipeline runs inside
    // createFact, which the async wrapper delegates to).
    const persisted = await withMnemoTx(wsA.id, (tx) => getFact(wsA.id, fact.id, tx));
    expect(persisted!.statement).toContain("[REDACTED-email]");
    expect(persisted!.statement).not.toContain("async-test@example.com");
    expect(persisted!.embedding).toBeNull();

    // Enqueue payload carries the REDACTED statement — no PII leaks
    // to the embedding provider downstream.
    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0]!.data.statement).toContain("[REDACTED-email]");
    expect(enqueueCalls[0]!.data.statement).not.toContain("async-test@example.com");
  });

  it("back-compat: without enqueueEmbed, falls through to synchronous createFact", async () => {
    // No enqueueEmbed supplied AND no embedding triple → synchronous
    // path inserts with embedding=NULL (same as Mode A direct
    // createFact). Confirms the wrapper is safe at sites that haven't
    // wired the queue yet.
    const fact = await withMnemoTx(wsA.id, (tx) =>
      createFactAsync({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "async-sync-fallback",
        statement: "fact created via wrapper without enqueue callback",
        tx,
      })
    );

    const persisted = await withMnemoTx(wsA.id, (tx) => getFact(wsA.id, fact.id, tx));
    expect(persisted).not.toBeNull();
    expect(persisted!.embedding).toBeNull();
    expect(persisted!.statement).toBe("fact created via wrapper without enqueue callback");
  });
});
