// packages/mnemosyne/tests/integration/mode-a-e2e.spec.ts
//
// Mode A end-to-end: no embedding provider, no LLM judge, no AI calls
// whatsoever. We create one of each primitive (fact, decision, relation,
// citation) inside a single workspace and assert that
//   - the fact landed without an embedding (Mode A invariant: embedding
//     stays NULL when callers omit `embedding{Provider,Model,Fn}`),
//   - the conflict-on-write loop is short-circuited
//     (checkConflicts:"none" ⇒ judgmentRequired:false), so we never need
//     to call out for embeddings or a judge model,
//   - the relation row exists with `pending` status (the candidate path
//     never ran, so it stays pending until manually judged),
//   - the citation gets a `mcit_*` id (the package-clean prefix from
//     createCitation).
//
// This is the contract for "minimal deployment": ship Mnemosyne without
// any provider keys and the four primitives still compose.
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
let saveDecisionWithCandidates: typeof import("../../src/conflict/candidate").saveDecisionWithCandidates;
let createRelation: typeof import("../../src/graph/relation").createRelation;
let createCitation: typeof import("../../src/citation/store").createCitation;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ saveDecisionWithCandidates } = await import("../../src/conflict/candidate"));
  ({ createRelation } = await import("../../src/graph/relation"));
  ({ createCitation } = await import("../../src/citation/store"));
});

afterAll(() => teardownTestWorkspaces());

describe("Mode A end-to-end (no AI required)", () => {
  it("creates fact + decision + relation + citation without any LLM/embedding call", async () => {
    // 1. Fact: no embedding* fields → embedding stays NULL (Mode A).
    const fact = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "prefers Spanish responses",
        tx,
      })
    );
    expect(fact.id).toMatch(/^mfact_/);
    expect(fact.embedding).toBeNull();

    // 2. Decision with checkConflicts:"none" — saveDecisionWithCandidates
    //    short-circuits the FTS candidate loop, so no judgment is needed
    //    and no LLM judge is called.
    const decResult = await withMnemoTx(wsA.id, (tx) =>
      saveDecisionWithCandidates({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Refund policy v1",
        body: "30 days for digital goods",
        checkConflicts: "none",
        tx,
      })
    );
    expect(decResult.decision.id).toMatch(/^mdec_/);
    expect(decResult.judgmentRequired).toBe(false);
    expect(decResult.candidates).toHaveLength(0);
    expect(decResult.decision.embedding).toBeNull();

    // 3. Relation linking the fact ↔ decision (system-marked, pending).
    const rel = await withMnemoTx(wsA.id, (tx) =>
      createRelation({
        workspaceId: wsA.id,
        sourceKind: "fact",
        sourceId: fact.id,
        targetKind: "decision",
        targetId: decResult.decision.id,
        relation: "related",
        markedByKind: "user",
        tx,
      })
    );
    expect(rel.id).toMatch(/^mrel_/);
    expect(rel.judgmentStatus).toBe("pending");

    // 4. Citation pointing the fact back to a user_edit source — provenance
    //    trail closes the loop without any extractor/judge model fields.
    const cit = await withMnemoTx(wsA.id, (tx) =>
      createCitation({
        workspaceId: wsA.id,
        memoryKind: "fact",
        memoryId: fact.id,
        sourceKind: "user_edit",
        sourceId: null,
        evidenceExcerpt: "manually entered",
        tx,
      })
    );
    expect(cit.id).toMatch(/^mcit_/);
    expect(cit.extractorModel).toBeNull();
    expect(cit.judgeModel).toBeNull();
  });
});
