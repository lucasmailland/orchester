// packages/mnemosyne/tests/integration/summary-heuristic-fallback.spec.ts
//
// When the host doesn't provide an LLM (Mode A workspace) we still
// want to populate a useful `mnemo_summary` row from a heuristic
// pass — the agent runtime can then inject a coarse identity line
// instead of nothing at all.
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
let getOrComputeSummary: typeof import("../../src/summary").getOrComputeSummary;
let getSummary: typeof import("../../src/summary").getSummary;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ getOrComputeSummary, getSummary } = await import("../../src/summary"));
});

afterAll(() => teardownTestWorkspaces());

describe("summary — heuristic fallback (no LLM)", () => {
  it("produces a non-null summary from facts without invoking an LLM", async () => {
    // Use a different agent than the other suite so this run is clean.
    const agentId = wsA.agentIds[2]!;

    await withMnemoTx(wsA.id, async (tx) => {
      await createFact({
        workspaceId: wsA.id,
        agentId,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: "Maria works at Acme Industries in Mexico City",
        tx,
      });
      await createFact({
        workspaceId: wsA.id,
        agentId,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "prefers concise responses in Spanish for status updates",
        tx,
      });
      await createFact({
        workspaceId: wsA.id,
        agentId,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "prefers async-first communication for cross-team work",
        tx,
      });
    });

    // No LLM, no model → must fall back to heuristic.
    const summary = await getOrComputeSummary({
      workspaceId: wsA.id,
      agentId,
    });

    expect(summary).not.toBeNull();
    expect(summary!.identity.length).toBeGreaterThan(0);
    expect(summary!.rawText.length).toBeGreaterThan(0);
    expect(summary!.sourceFactIds.length).toBeGreaterThanOrEqual(3);

    // Persisted with modelUsed=NULL (heuristic).
    const row = await withMnemoTx(wsA.id, (tx) => getSummary(wsA.id, agentId, null, tx));
    expect(row).not.toBeNull();
    expect(row!.modelUsed).toBeNull();
    expect(row!.summaryText).toBe(summary!.rawText);
  });

  it("falls back to heuristic when the LLM throws", async () => {
    const agentId = wsA.agentIds[2]!;
    // Seed in case the previous test was skipped.
    await withMnemoTx(wsA.id, async (tx) => {
      await createFact({
        workspaceId: wsA.id,
        agentId,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: "Carlos lives in Madrid and runs an architecture studio",
        tx,
      });
    });

    const llm = vi.fn(async () => {
      throw new Error("simulated provider outage");
    });

    const summary = await getOrComputeSummary({
      workspaceId: wsA.id,
      agentId,
      llm,
      model: "test:fast",
      forceRefresh: true,
    });

    expect(summary).not.toBeNull();
    expect(summary!.identity.length).toBeGreaterThan(0);
    // Heuristic path → modelUsed remains null in the persisted row.
    const row = await withMnemoTx(wsA.id, (tx) => getSummary(wsA.id, agentId, null, tx));
    expect(row).not.toBeNull();
    expect(row!.modelUsed).toBeNull();
  });
});
