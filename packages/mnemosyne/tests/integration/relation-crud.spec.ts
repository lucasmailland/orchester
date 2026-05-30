import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let createRelation: typeof import("../../src/graph/relation").createRelation;
let listPendingRelations: typeof import("../../src/graph/relation").listPendingRelations;
let judgeRelation: typeof import("../../src/graph/relation").judgeRelation;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;
let createDecision: typeof import("../../src/primitives/decision").createDecision;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ createRelation, listPendingRelations, judgeRelation } =
    await import("../../src/graph/relation"));
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createDecision } = await import("../../src/primitives/decision"));
});
afterAll(() => teardownTestWorkspaces());

describe("graph/relation", () => {
  it("creates a pending relation between two decisions", async () => {
    const d1 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Old refund policy",
        body: "30 days",
        tx,
      })
    );
    const d2 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "New refund policy",
        body: "60 days",
        tx,
      })
    );
    const r = await withMnemoTx(wsA.id, (tx) =>
      createRelation({
        workspaceId: wsA.id,
        sourceKind: "decision",
        sourceId: d2.id,
        targetKind: "decision",
        targetId: d1.id,
        relation: "supersedes",
        markedByKind: "system",
        tx,
      })
    );
    expect(r.id).toMatch(/^mrel_/);
    expect(r.judgmentStatus).toBe("pending");
    expect(r.relation).toBe("supersedes");
    expect(r.sourceId).toBe(d2.id);
    expect(r.targetId).toBe(d1.id);
  });

  it("lists pending relations for a workspace", async () => {
    const pending = await withMnemoTx(wsA.id, (tx) => listPendingRelations(wsA.id, 10, tx));
    expect(pending.length).toBeGreaterThan(0);
    for (const r of pending) {
      expect(r.judgmentStatus).toBe("pending");
    }
  });

  it("rejects invalid relation verb", async () => {
    await expect(
      withMnemoTx(wsA.id, (tx) =>
        createRelation({
          workspaceId: wsA.id,
          sourceKind: "decision",
          sourceId: "mdec_x",
          targetKind: "decision",
          targetId: "mdec_y",
          // @ts-expect-error - intentionally bad verb
          relation: "not_a_real_verb",
          markedByKind: "system",
          tx,
        })
      )
    ).rejects.toThrow(/invalid relation verb/);
  });

  it("judgeRelation updates verb + status='judged'", async () => {
    const d1 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Source for judge",
        body: "Source body",
        tx,
      })
    );
    const d2 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Target for judge",
        body: "Target body",
        tx,
      })
    );
    const r = await withMnemoTx(wsA.id, (tx) =>
      createRelation({
        workspaceId: wsA.id,
        sourceKind: "decision",
        sourceId: d1.id,
        targetKind: "decision",
        targetId: d2.id,
        relation: "related",
        markedByKind: "system",
        tx,
      })
    );
    const judged = await withMnemoTx(wsA.id, (tx) =>
      judgeRelation({
        workspaceId: wsA.id,
        relationId: r.id,
        newRelation: "conflicts_with",
        reason: "LLM judge found contradiction",
        confidence: 0.85,
        markedByKind: "llm_judge",
        markedByModel: "test-model",
        tx,
      })
    );
    expect(judged).not.toBeNull();
    expect(judged?.judgmentStatus).toBe("judged");
    expect(judged?.relation).toBe("conflicts_with");
    expect(judged?.confidence).toBeCloseTo(0.85);
    expect(judged?.markedByKind).toBe("llm_judge");
  });

  it("provenance: defaults to NULL (LLM-derived) and persists 'heuristic' when set", async () => {
    // v1.1 #11 — round-trip provenance through createRelation.
    const d1 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Provenance source",
        body: "src",
        tx,
      })
    );
    const d2 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Provenance target",
        body: "tgt",
        tx,
      })
    );

    // Default: no provenance field => persisted as NULL (LLM-derived).
    const rDefault = await withMnemoTx(wsA.id, (tx) =>
      createRelation({
        workspaceId: wsA.id,
        sourceKind: "decision",
        sourceId: d1.id,
        targetKind: "decision",
        targetId: d2.id,
        relation: "related",
        markedByKind: "llm_judge",
        tx,
      })
    );
    expect(rDefault.provenance).toBeNull();

    // Explicit 'heuristic' value round-trips through the insert.
    const rHeuristic = await withMnemoTx(wsA.id, (tx) =>
      createRelation({
        workspaceId: wsA.id,
        sourceKind: "decision",
        sourceId: d1.id,
        targetKind: "decision",
        targetId: d2.id,
        relation: "related",
        markedByKind: "system",
        provenance: "heuristic",
        tx,
      })
    );
    expect(rHeuristic.provenance).toBe("heuristic");
  });

  it("multi-actor disagreement allowed (no UNIQUE on source+target+verb)", async () => {
    const d1 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Multi-actor source",
        body: "src",
        tx,
      })
    );
    const d2 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Multi-actor target",
        body: "tgt",
        tx,
      })
    );
    const r1 = await withMnemoTx(wsA.id, (tx) =>
      createRelation({
        workspaceId: wsA.id,
        sourceKind: "decision",
        sourceId: d1.id,
        targetKind: "decision",
        targetId: d2.id,
        relation: "conflicts_with",
        markedByKind: "agent",
        tx,
      })
    );
    const r2 = await withMnemoTx(wsA.id, (tx) =>
      createRelation({
        workspaceId: wsA.id,
        sourceKind: "decision",
        sourceId: d1.id,
        targetKind: "decision",
        targetId: d2.id,
        relation: "conflicts_with",
        markedByKind: "llm_judge",
        tx,
      })
    );
    // Same source/target/verb, but two distinct rows must exist.
    expect(r2.id).not.toBe(r1.id);
  });

  // v1.1 #12 — inverted-interval WRITE guard
  it("rejects a validTo that is before validFrom", async () => {
    const d1 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "interval guard src",
        body: "src body",
        tx,
      })
    );
    const d2 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "interval guard dst",
        body: "dst body",
        tx,
      })
    );

    const past = new Date("2020-01-01T00:00:00Z");
    const future = new Date("2030-01-01T00:00:00Z");

    await expect(
      withMnemoTx(wsA.id, (tx) =>
        createRelation({
          workspaceId: wsA.id,
          sourceKind: "decision",
          sourceId: d1.id,
          targetKind: "decision",
          targetId: d2.id,
          relation: "related",
          markedByKind: "agent",
          validFrom: future,
          validTo: past, // inverted — must throw
          tx,
        })
      )
    ).rejects.toThrow("inverted validity interval");
  });

  it("accepts a valid interval (validFrom <= validTo)", async () => {
    const d1 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "valid interval src",
        body: "src body",
        tx,
      })
    );
    const d2 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "valid interval dst",
        body: "dst body",
        tx,
      })
    );

    const past = new Date("2020-01-01T00:00:00Z");
    const future = new Date("2030-01-01T00:00:00Z");

    // validFrom === validTo (edge case: point-in-time validity) — allowed.
    const r1 = await withMnemoTx(wsA.id, (tx) =>
      createRelation({
        workspaceId: wsA.id,
        sourceKind: "decision",
        sourceId: d1.id,
        targetKind: "decision",
        targetId: d2.id,
        relation: "compatible",
        markedByKind: "agent",
        validFrom: past,
        validTo: past,
        tx,
      })
    );
    expect(r1.validFrom).toEqual(past);
    expect(r1.validTo).toEqual(past);

    // validFrom < validTo — normal range.
    const r2 = await withMnemoTx(wsA.id, (tx) =>
      createRelation({
        workspaceId: wsA.id,
        sourceKind: "decision",
        sourceId: d1.id,
        targetKind: "decision",
        targetId: d2.id,
        relation: "scoped",
        markedByKind: "agent",
        validFrom: past,
        validTo: future,
        tx,
      })
    );
    expect(r2.validFrom).toEqual(past);
    expect(r2.validTo).toEqual(future);
  });
});
