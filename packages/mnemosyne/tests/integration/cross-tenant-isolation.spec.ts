// packages/mnemosyne/tests/integration/cross-tenant-isolation.spec.ts
//
// SECURITY GATE — proves that every mnemo_* table actually enforces
// workspace isolation via RLS + FORCE Pattern A. Without this test we'd
// be trusting that the policies in migrations 0018..0022 hold; this is
// where we prove it.
//
// Why `SET LOCAL ROLE app_user` per read:
// ─────────────────────────────────────────
// The testcontainer connects as the postgres superuser (see
// `apps/web/tests/fixtures/db.ts`). Superuser bypasses RLS *even with
// FORCE ROW LEVEL SECURITY enabled* — FORCE only revokes the OWNER
// bypass, not the superuser bypass. So a naive read inside
// `withMnemoTx(wsA.id, …)` would still return wsB rows under
// superuser, masking any RLS hole. The web app's isolation suite
// (`apps/web/tests/isolation/helpers.ts`) solves this with
// `SET LOCAL ROLE app_user` inside the transaction; we mirror that
// pattern here so the test actually exercises the policy.
//
// Test shape per primitive:
//   1. WRITE a row under wsB inside `withMnemoTx(wsB.id, …)` (superuser
//      path — RLS bypass is fine for seeding).
//   2. READ from wsA's transactional context with role dropped to
//      app_user, asking the primitive for the wsB row by id (or by
//      workspaceId = wsB.id). The app filter would match — RLS is the
//      only thing standing between wsA and wsB's data.
//
// If any of the 4 sub-tests surfaces wsB data, RLS+FORCE has a hole —
// STOP and audit migrations 0018..0022.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";

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
let listFacts: typeof import("../../src/primitives/fact").listFacts;
let createDecision: typeof import("../../src/primitives/decision").createDecision;
let getDecision: typeof import("../../src/primitives/decision").getDecision;
let createRelation: typeof import("../../src/graph/relation").createRelation;
let listPendingRelations: typeof import("../../src/graph/relation").listPendingRelations;
let createCitation: typeof import("../../src/citation/store").createCitation;
let listCitationsForMemory: typeof import("../../src/citation/store").listCitationsForMemory;

/**
 * Run `fn` inside a Mnemosyne transaction with role dropped to
 * `app_user` (no BYPASSRLS). `withMnemoTx` first sets `app.workspace_id`
 * as superuser; we immediately SET LOCAL ROLE so every subsequent query
 * in the tx runs under RLS. Both the GUC and the role are LOCAL so they
 * release on COMMIT/ROLLBACK without leaking to the next reservation.
 */
async function withMnemoTxAsAppUser<T>(
  workspaceId: string,
  fn: (tx: Parameters<Parameters<typeof withMnemoTx>[1]>[0]) => Promise<T>
): Promise<T> {
  return withMnemoTx(workspaceId, async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    return fn(tx);
  });
}

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact, listFacts } = await import("../../src/primitives/fact"));
  ({ createDecision, getDecision } = await import("../../src/primitives/decision"));
  ({ createRelation, listPendingRelations } = await import("../../src/graph/relation"));
  ({ createCitation, listCitationsForMemory } = await import("../../src/citation/store"));
});

afterAll(() => teardownTestWorkspaces());

describe("cross-tenant isolation (RLS+FORCE)", () => {
  it("workspace A cannot read workspace B mnemo_fact via listFacts", async () => {
    await withMnemoTx(wsB.id, (tx) =>
      createFact({
        workspaceId: wsB.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "B-only secret preference",
        tx,
      })
    );

    // From wsA's transactional context as app_user, ask listFacts to
    // return *wsB's* facts. The app filter would happily return them —
    // only RLS keeps wsA isolated.
    const wsAFacts = await withMnemoTxAsAppUser(wsA.id, (tx) =>
      listFacts({ workspaceId: wsB.id, tx })
    );
    expect(wsAFacts).toEqual([]);
  });

  it("workspace A cannot read workspace B mnemo_decision (getDecision)", async () => {
    const d = await withMnemoTx(wsB.id, (tx) =>
      createDecision({
        workspaceId: wsB.id,
        kind: "policy",
        title: "B-only policy",
        body: "secret to wsB",
        tx,
      })
    );

    // Asking for wsB's decision id from wsA's GUC as app_user must
    // return null because the policy filters the row out, even though
    // both the id and the workspace_id we pass match.
    const cross = await withMnemoTxAsAppUser(wsA.id, (tx) => getDecision(wsB.id, d.id, tx));
    expect(cross).toBeNull();
  });

  it("workspace A cannot read workspace B mnemo_relation (listPendingRelations)", async () => {
    // Seed two decisions and a pending relation under wsB.
    const d1 = await withMnemoTx(wsB.id, (tx) =>
      createDecision({
        workspaceId: wsB.id,
        kind: "policy",
        title: "B-source",
        body: "x",
        tx,
      })
    );
    const d2 = await withMnemoTx(wsB.id, (tx) =>
      createDecision({
        workspaceId: wsB.id,
        kind: "policy",
        title: "B-target",
        body: "y",
        tx,
      })
    );
    await withMnemoTx(wsB.id, (tx) =>
      createRelation({
        workspaceId: wsB.id,
        sourceKind: "decision",
        sourceId: d1.id,
        targetKind: "decision",
        targetId: d2.id,
        relation: "related",
        markedByKind: "system",
        tx,
      })
    );

    // List wsB's pending relations from wsA's tx as app_user. The app
    // filter targets wsB rows — RLS is the only barrier preventing
    // them from surfacing.
    const wsBPendingFromA = await withMnemoTxAsAppUser(wsA.id, (tx) =>
      listPendingRelations(wsB.id, 100, tx)
    );
    expect(wsBPendingFromA).toEqual([]);
  });

  it("workspace A cannot read workspace B mnemo_citation (listCitationsForMemory)", async () => {
    await withMnemoTx(wsB.id, (tx) =>
      createCitation({
        workspaceId: wsB.id,
        memoryKind: "fact",
        memoryId: "mfact_b_only",
        sourceKind: "user_edit",
        evidenceExcerpt: "B-only citation",
        tx,
      })
    );

    // Looking up wsB's citation from wsA's tx as app_user must yield an
    // empty array — the row exists, the app filter matches, RLS strips
    // it.
    const wsACitations = await withMnemoTxAsAppUser(wsA.id, (tx) =>
      listCitationsForMemory(wsB.id, "fact", "mfact_b_only", tx)
    );
    expect(wsACitations).toEqual([]);
  });
});
