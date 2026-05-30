// packages/mnemosyne/tests/integration/recall-hebbian.spec.ts
//
// Integration tests for v1.1 #10 — Hebbian potentiation + Ebbinghaus decay.
// Verifies that markRecalled() correctly updates memory_strength,
// memory_stability, and last_strength_update in the database.
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
import {
  POTENTIATION_INCREMENT,
  STABILITY_INCREMENT,
  MAX_MEMORY_STRENGTH,
  MIN_MEMORY_STRENGTH,
} from "../../src/primitives/fact";

let wsA: WsFixture;
let createFact: typeof import("../../src/primitives/fact").createFact;
let markRecalled: typeof import("../../src/primitives/fact").markRecalled;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ createFact, markRecalled } = await import("../../src/primitives/fact"));
  ({ withMnemoTx } = await import("../../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

/** Read memory columns back from the DB for a given factId. */
async function readMemoryColumns(factId: string) {
  return withMnemoTx(wsA.id, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT memory_strength, memory_stability, last_strength_update,
             hit_count, last_recalled_at
      FROM mnemo_fact
      WHERE id = ${factId} AND workspace_id = ${wsA.id}
    `)) as unknown as Array<{
      memory_strength: string | number;
      memory_stability: string | number;
      last_strength_update: Date | null;
      hit_count: string | number;
      last_recalled_at: Date | null;
    }>;
    const r = rows[0];
    if (!r) throw new Error(`fact ${factId} not found`);
    return {
      memoryStrength: Number(r.memory_strength),
      memoryStability: Number(r.memory_stability),
      lastStrengthUpdate: r.last_strength_update,
      hitCount: Number(r.hit_count),
      lastRecalledAt: r.last_recalled_at,
    };
  });
}

describe("markRecalled — Hebbian potentiation (v1.1 #10)", () => {
  it("sets default columns (1.0/1.0/null) before any recall", async () => {
    const fact = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "hebbian-default-check",
        statement: "Hebbian default: memory_strength should be 1.0 before first recall",
        tx,
      })
    );
    const before = await readMemoryColumns(fact.id);
    expect(before.memoryStrength).toBeCloseTo(1.0, 4);
    expect(before.memoryStability).toBeCloseTo(1.0, 4);
    expect(before.lastStrengthUpdate).toBeNull();
    expect(before.hitCount).toBe(0);
  });

  it("potentiates on first recall: strength → 1.0 + POTENTIATION_INCREMENT", async () => {
    const fact = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "hebbian-first-potentiation",
        statement: "Hebbian test: first recall should potentiate from 1.0",
        tx,
      })
    );

    await withMnemoTx(wsA.id, (tx) => markRecalled(wsA.id, [fact.id], tx));

    const after = await readMemoryColumns(fact.id);
    // First recall: last_strength_update was NULL → potentiate immediately
    expect(after.memoryStrength).toBeCloseTo(1.0 + POTENTIATION_INCREMENT, 4);
    expect(after.memoryStability).toBeCloseTo(1.0 + STABILITY_INCREMENT, 4);
    expect(after.lastStrengthUpdate).not.toBeNull();
    expect(after.hitCount).toBe(1);
    expect(after.lastRecalledAt).not.toBeNull();
  });

  it("does NOT potentiate again on rapid second recall (Cepeda spacing guard)", async () => {
    const fact = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "hebbian-cepeda-guard",
        statement: "Hebbian Cepeda: second rapid recall must not double-potentiate",
        tx,
      })
    );

    // First recall: potentiates (first update always potentiates)
    await withMnemoTx(wsA.id, (tx) => markRecalled(wsA.id, [fact.id], tx));
    const afterFirst = await readMemoryColumns(fact.id);
    const strengthAfterFirst = afterFirst.memoryStrength;
    const stabilityAfterFirst = afterFirst.memoryStability;

    // Second recall in the same second — well within the 1-hour Cepeda window
    await withMnemoTx(wsA.id, (tx) => markRecalled(wsA.id, [fact.id], tx));
    const afterSecond = await readMemoryColumns(fact.id);

    // Strength should be essentially unchanged (no potentiation; only decay
    // from the near-zero elapsed time, which is exp(≈0) ≈ 1.0).
    // We accept a tolerance of 0.01 to account for sub-second decay.
    expect(afterSecond.memoryStrength).toBeGreaterThanOrEqual(strengthAfterFirst - 0.01);
    // Crucially, it should NOT have jumped by another POTENTIATION_INCREMENT
    expect(afterSecond.memoryStrength).toBeLessThan(strengthAfterFirst + POTENTIATION_INCREMENT);
    // Stability also unchanged
    expect(afterSecond.memoryStability).toBeCloseTo(stabilityAfterFirst, 3);
    // hit_count still increments (hit_count tracks every recall)
    expect(afterSecond.hitCount).toBe(2);
  });

  it("strength is capped at MAX_MEMORY_STRENGTH regardless of repeated potentiations", async () => {
    const fact = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "hebbian-max-cap",
        statement: "Hebbian cap: direct-DB seed to MAX then recall must not exceed MAX",
        tx,
      })
    );

    // Seed memory_strength to MAX directly so we don't need 80 potentiations
    await withMnemoTx(wsA.id, (tx) =>
      tx.execute(sql`
        UPDATE mnemo_fact
        SET memory_strength = ${MAX_MEMORY_STRENGTH}
        WHERE id = ${fact.id} AND workspace_id = ${wsA.id}
      `)
    );

    // First recall: last_strength_update is still NULL, so the CASE goes to
    // the first branch: LEAST(MAX, MAX + INCREMENT) = MAX
    await withMnemoTx(wsA.id, (tx) => markRecalled(wsA.id, [fact.id], tx));
    const after = await readMemoryColumns(fact.id);
    expect(after.memoryStrength).toBeLessThanOrEqual(MAX_MEMORY_STRENGTH + 0.001);
  });

  it("strength never drops below MIN_MEMORY_STRENGTH", async () => {
    const fact = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "hebbian-min-floor",
        statement: "Hebbian floor: even highly decayed strength floors at MIN",
        tx,
      })
    );

    // Seed a very weak strength with an old timestamp so the Ebbinghaus decay
    // drives it below MIN_MEMORY_STRENGTH and the floor must kick in.
    // We use 3 days ago (not extreme) to avoid floating-point edge cases:
    //   decay = 0.051 * exp(-3 / 1.0) ≈ 0.051 * 0.050 ≈ 0.0025 → floored to 0.05
    //   potentiate (spacing = 3 days > 1h): 0.05 + 0.05 = 0.10
    await withMnemoTx(wsA.id, (tx) =>
      tx.execute(sql`
        UPDATE mnemo_fact
        SET memory_strength      = 0.051,
            memory_stability     = 1.0,
            last_strength_update = NOW() - INTERVAL '3 days',
            last_recalled_at     = NOW() - INTERVAL '3 days'
        WHERE id = ${fact.id} AND workspace_id = ${wsA.id}
      `)
    );

    await withMnemoTx(wsA.id, (tx) => markRecalled(wsA.id, [fact.id], tx));
    const after = await readMemoryColumns(fact.id);
    // Raw decay brings strength below MIN → floored to MIN; spacing > 1h
    // means potentiation also fires → result = MIN + INCREMENT.
    expect(after.memoryStrength).toBeGreaterThanOrEqual(MIN_MEMORY_STRENGTH);
    expect(after.memoryStrength).toBeCloseTo(MIN_MEMORY_STRENGTH + POTENTIATION_INCREMENT, 3);
  });

  it("markRecalled on an empty factIds array is a no-op", async () => {
    // Should not throw
    await expect(
      withMnemoTx(wsA.id, (tx) => markRecalled(wsA.id, [], tx))
    ).resolves.toBeUndefined();
  });

  it("markRecalled potentiates multiple facts in one call", async () => {
    const factA = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "hebbian-bulk-a",
        statement: "Hebbian bulk: fact A for multi-id recall",
        tx,
      })
    );
    const factB = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "hebbian-bulk-b",
        statement: "Hebbian bulk: fact B for multi-id recall",
        tx,
      })
    );

    await withMnemoTx(wsA.id, (tx) => markRecalled(wsA.id, [factA.id, factB.id], tx));

    const a = await readMemoryColumns(factA.id);
    const b = await readMemoryColumns(factB.id);
    expect(a.memoryStrength).toBeCloseTo(1.0 + POTENTIATION_INCREMENT, 4);
    expect(b.memoryStrength).toBeCloseTo(1.0 + POTENTIATION_INCREMENT, 4);
    expect(a.hitCount).toBe(1);
    expect(b.hitCount).toBe(1);
  });
});
