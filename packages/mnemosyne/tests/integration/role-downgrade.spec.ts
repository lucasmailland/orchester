// packages/mnemosyne/tests/integration/role-downgrade.spec.ts
//
// SECURITY REGRESSION — proves `withMnemoTx` itself downgrades to a
// non-BYPASSRLS role, so RLS+FORCE Pattern A actually enforces in
// production paths that go through the wrapper.
//
// Why this exists (P0 audit, 2026-05-24):
// ──────────────────────────────────────
// Until this commit, `withMnemoTx` only set `app.workspace_id` and
// inherited the connection role — which is `orchester` superuser
// (rolsuper=t, rolbypassrls=t) in production. RLS+FORCE on every
// `mnemo_*` table was silently bypassed by the deployed app. The
// existing `cross-tenant-isolation.spec.ts` only proved the policies
// were correct WHEN A TEST MANUALLY ran `SET LOCAL ROLE app_user`;
// it said nothing about the wrapper-built-in path.
//
// This spec exercises the new built-in `SET LOCAL ROLE app_user`
// inside `withMnemoTx`:
//   1. Outside the wrapper, `current_user` is the testcontainer
//      superuser (`postgres`).
//   2. Inside `withMnemoTx`, `current_user` is `app_user` — proving
//      the role downgrade fires automatically.
//   3. Cross-workspace SELECT through the wrapper returns 0 rows,
//      proving RLS+FORCE actually blocks (not just the GUC). This
//      regression test would have failed before the fix (superuser
//      would have returned wsB's row), and it must keep failing if
//      anyone deletes the `SET LOCAL ROLE` line again.
//
// See `docs/specs/audits/2026-05-24-mnemosyne-v1-final-audit.md` §1.b
// and `docs/adr/0010-rls-force-defense-in-depth.md` "Amendment 2026-05-25".
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
let getDb: typeof import("@orchester/db").getDb;

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ getDb } = await import("@orchester/db"));
});

afterAll(() => teardownTestWorkspaces());

describe("withMnemoTx — SET LOCAL ROLE app_user downgrade (P0 audit 2026-05-24)", () => {
  it("outside the wrapper, current_user is the elevated testcontainer role", async () => {
    // The testcontainer connects as `postgres` (see
    // `apps/web/tests/fixtures/db.ts`). This is the deployed parallel
    // of the production `orchester` superuser the audit flagged: a
    // role with `rolbypassrls=t` that would silently skip RLS+FORCE
    // if the wrapper failed to downgrade.
    const db = getDb();
    const rows = (await db.execute(
      sql`SELECT current_user::text AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`
    )) as unknown as Array<{ u: string; rolsuper: boolean; rolbypassrls: boolean }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.u).toBe("postgres");
    // Sanity check: the baseline role IS elevated — without the
    // wrapper's downgrade, RLS would be theatre.
    expect(rows[0]!.rolbypassrls).toBe(true);
  });

  it("inside withMnemoTx, current_user is app_user (LOCAL role downgrade)", async () => {
    const result = await withMnemoTx(wsA.id, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT current_user::text AS u, current_setting('app.workspace_id', true) AS ws`
      )) as unknown as Array<{ u: string; ws: string }>;
      return rows[0]!;
    });
    // SET LOCAL ROLE downgraded the tx to `app_user` (NOINHERIT LOGIN,
    // no BYPASSRLS — migration 0007_postgres_roles.sql).
    expect(result.u).toBe("app_user");
    // GUC is still set in lockstep, so RLS policies that gate on
    // current_workspace_id() resolve to wsA.id.
    expect(result.ws).toBe(wsA.id);
  });

  it("after the tx ends, current_user reverts (SET LOCAL didn't leak)", async () => {
    // Run the wrapper once, then probe outside it: the elevated role
    // is back. Without LOCAL scope, the next caller would inherit
    // app_user and probably fail with grant errors on some paths.
    await withMnemoTx(wsA.id, async (tx) => {
      await tx.execute(sql`SELECT 1`);
    });
    const db = getDb();
    const rows = (await db.execute(sql`SELECT current_user::text AS u`)) as unknown as Array<{
      u: string;
    }>;
    expect(rows[0]!.u).toBe("postgres");
  });

  it("regression (P0): cross-workspace SELECT through withMnemoTx returns 0 rows even on a superuser-tier connection", async () => {
    // Seed: one fact in each workspace. Both writes go through
    // `withMnemoTx` (which now downgrades to app_user), so each
    // INSERT is gated by the Pattern A WITH CHECK that the row's
    // workspace_id matches `current_workspace_id()` — they pass.
    await withMnemoTx(wsA.id, async (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "A-only role-downgrade regression seed",
        tx,
      })
    );

    await withMnemoTx(wsB.id, async (tx) =>
      createFact({
        workspaceId: wsB.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "B-only role-downgrade regression seed",
        tx,
      })
    );

    // From wsA's wrapper, try to SELECT wsB's row by its known
    // workspace_id. Before the P0 fix, the underlying connection was
    // superuser so this would have returned the wsB row and silently
    // leaked data. After the fix, SET LOCAL ROLE app_user makes RLS
    // FORCE actually apply, and the workspace_id filter in the
    // Pattern A policy strips the row.
    const leaked = await withMnemoTx(wsA.id, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT id FROM mnemo_fact WHERE workspace_id = ${wsB.id}`
      )) as unknown as Array<{ id: string }>;
      return rows;
    });
    expect(leaked).toEqual([]);

    // Ground-truth check: from wsB's wrapper, wsB's own fact IS
    // visible — proves the policy is filtering by GUC, not denying
    // everything.
    const ownRows = await withMnemoTx(wsB.id, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT id FROM mnemo_fact WHERE workspace_id = ${wsB.id}`
      )) as unknown as Array<{ id: string }>;
      return rows;
    });
    expect(ownRows.length).toBeGreaterThan(0);
  });
});
