// packages/mnemosyne/tests/integration/actor-isolation.spec.ts
//
// Mnemosyne v1.6 G2 — per-actor RLS enforcement on mnemo_fact.
//
// Migration 0040 adds an opt-in SELECT policy:
//   • When `app.enforce_actor_isolation = 'true'`, only rows where
//     `actor_id IS NULL OR actor_id = current_setting('app.actor_id')`
//     are visible.
//   • When the GUC is absent, the policy short-circuits to true and
//     every workspace fact is visible (legacy behaviour).
//
// This spec proves both halves:
//   1. Without the GUC, all facts in the workspace are visible
//      (including mixed actor_ids and NULL).
//   2. With the GUC set to 'true' + a specific app.actor_id, only
//      that actor's facts AND workspace-shared (NULL) facts come back.
//
// Patterned after `cross-tenant-isolation.spec.ts` — the test runs
// under `SET LOCAL ROLE app_user` so the policy actually applies
// (superuser would bypass RLS even with FORCE).
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
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;
let createFact: typeof import("../../src/primitives/fact").createFact;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
});

afterAll(() => teardownTestWorkspaces());

describe("actor isolation policy — opt-in via app.enforce_actor_isolation", () => {
  it("without the GUC, every workspace fact is visible regardless of actor_id", async () => {
    // Seed a mix: alice's facts, bob's facts, NULL workspace-shared.
    await withMnemoTx(wsA.id, async (tx) => {
      await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "alice",
        statement: "alice prefers Spanish responses ACTOR_ISO_SEED",
        actorId: "user_alice",
        tx,
      });
      await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "bob",
        statement: "bob prefers English responses ACTOR_ISO_SEED",
        actorId: "user_bob",
        tx,
      });
      await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "workspace",
        statement: "company timezone is UTC ACTOR_ISO_SEED",
        actorId: null, // workspace-shared
        tx,
      });
    });

    // Read with role downgraded to app_user, GUC NOT set. All three
    // rows should come back (the only filter is workspace).
    const rows = await withMnemoTx(wsA.id, async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      const r = (await tx.execute(sql`
        SELECT id, actor_id, statement
        FROM mnemo_fact
        WHERE workspace_id = ${wsA.id}
          AND statement LIKE '%ACTOR_ISO_SEED%'
      `)) as unknown as Array<{ id: string; actor_id: string | null; statement: string }>;
      return r;
    });

    expect(rows.length).toBe(3);
    const actorIds = new Set(rows.map((r) => r.actor_id));
    expect(actorIds.has("user_alice")).toBe(true);
    expect(actorIds.has("user_bob")).toBe(true);
    expect(actorIds.has(null)).toBe(true);
  });

  it("with the GUC + app.actor_id, only that actor's facts + workspace-shared are visible", async () => {
    // Same seed via the new opts-form of withMnemoTx — sets both
    // app.actor_id AND app.enforce_actor_isolation in one shot.
    const visible = await withMnemoTx(
      {
        workspaceId: wsA.id,
        actorId: "user_alice",
        enforceActorIsolation: true,
      },
      async (tx) => {
        const r = (await tx.execute(sql`
          SELECT id, actor_id, statement
          FROM mnemo_fact
          WHERE workspace_id = ${wsA.id}
            AND statement LIKE '%ACTOR_ISO_SEED%'
        `)) as unknown as Array<{ id: string; actor_id: string | null; statement: string }>;
        return r;
      }
    );

    // Alice + NULL should be visible. Bob should NOT.
    const actorIds = visible.map((r) => r.actor_id);
    expect(actorIds.some((a) => a === "user_alice")).toBe(true);
    expect(actorIds.some((a) => a === null)).toBe(true);
    expect(actorIds.includes("user_bob")).toBe(false);
  });

  it("with the GUC + a different app.actor_id, swaps which facts are visible", async () => {
    const visible = await withMnemoTx(
      {
        workspaceId: wsA.id,
        actorId: "user_bob",
        enforceActorIsolation: true,
      },
      async (tx) => {
        const r = (await tx.execute(sql`
          SELECT id, actor_id, statement
          FROM mnemo_fact
          WHERE workspace_id = ${wsA.id}
            AND statement LIKE '%ACTOR_ISO_SEED%'
        `)) as unknown as Array<{ id: string; actor_id: string | null; statement: string }>;
        return r;
      }
    );

    const actorIds = visible.map((r) => r.actor_id);
    expect(actorIds.includes("user_bob")).toBe(true);
    expect(actorIds.some((a) => a === null)).toBe(true);
    expect(actorIds.includes("user_alice")).toBe(false);
  });

  it("with the GUC + an unknown app.actor_id, only workspace-shared facts visible", async () => {
    const visible = await withMnemoTx(
      {
        workspaceId: wsA.id,
        actorId: "user_ghost",
        enforceActorIsolation: true,
      },
      async (tx) => {
        const r = (await tx.execute(sql`
          SELECT id, actor_id, statement
          FROM mnemo_fact
          WHERE workspace_id = ${wsA.id}
            AND statement LIKE '%ACTOR_ISO_SEED%'
        `)) as unknown as Array<{ id: string; actor_id: string | null; statement: string }>;
        return r;
      }
    );

    // Only the NULL (workspace-shared) row.
    expect(visible.every((r) => r.actor_id === null)).toBe(true);
    expect(visible.length).toBeGreaterThanOrEqual(1);
  });
});
