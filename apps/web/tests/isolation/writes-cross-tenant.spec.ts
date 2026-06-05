// apps/web/tests/isolation/writes-cross-tenant.spec.ts
//
// Cross-tenant WRITE isolation matrix — the missing third of the G.1
// suite, complementing the SELECT scan in `db-scan.spec.ts`.
//
// For every representative Pattern A FORCE RLS table, we verify the
// three write-paths a malicious or buggy caller could attempt:
//
//   1. INSERT with `workspace_id = <foreign>`:
//      The RLS WITH CHECK predicate runs against the row being
//      inserted, NOT the current GUC. If `app.workspace_id` ≠ the new
//      row's workspace_id, Postgres raises
//      "new row violates row-level security policy". This is the
//      hard rejection — the row never lands.
//
//   2. UPDATE on a foreign-workspace row (looked up by id):
//      The USING predicate filters the row out BEFORE the update
//      considers it. Result: 0 rows affected, no error. This matches
//      the route-layer 404 contract (item 3 of the G.1 spec: "writes
//      reject foreign ids with 404 — not 403 — non-enumerable").
//
//   3. DELETE of a foreign-workspace row:
//      Same shape as UPDATE — USING filters first, so 0 rows are
//      deleted. The foreign row is still visible to cron_admin
//      afterwards (we assert this).
//
// Why a curated table list instead of all 21:
//   • db-scan already exhaustively walks every Pattern A table for
//     SELECT. The write semantics are uniform across Pattern A — if
//     the four policies (SELECT/INSERT/UPDATE/DELETE) are present and
//     FORCE is set, the matrix is determined.
//   • audit_log and security_event have `REVOKE UPDATE, DELETE` for
//     app_user (migration 0007), so the UPDATE/DELETE arms would fail
//     with "permission denied" instead of "0 rows affected" — a
//     different surface that warrants its own test. Skipped here;
//     the audit-chain integration suite covers append-only semantics.
//   • The 6 tables below cover: agent (basic shape), conversation
//     (parent for message JOIN policy), api_key (sensitive cred),
//     knowledge_base (FK parent for chunks/docs), feature_flag
//     (admin surface), ai_provider (encrypted cred).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Integration tests need the real DB module — un-mock before any dynamic imports.
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupIsolation,
  teardownIsolation,
  withAppUserContext,
  withCronAdminContext,
  type IsolationFixture,
  type SqlExecutor,
} from "./helpers";
import { teardownTestWorkspaces } from "../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let f: IsolationFixture;

/**
 * Per-table seed + write-path adapter. Each table needs a tailored
 * INSERT (different required columns, different unique keys) but the
 * write-matrix shape is identical. The adapter encapsulates the
 * differences so the it.each block stays one set of assertions.
 *
 * All write methods take a `tx: SqlExecutor` — they MUST run inside
 * the tenant-scoped transaction so RLS applies. Seeding uses the raw
 * superuser client (`f.sql`) to populate without RLS interference.
 */
interface WriteAdapter {
  table: string;
  /** Seed a canary row in the given workspace via superuser sql. */
  seed: (wsId: string) => Promise<string>;
  /** Attempt INSERT inside `tx` with the given workspace_id (used to
   *  inject across tenants). */
  insertWithWorkspaceTx: (tx: SqlExecutor, id: string, workspaceId: string) => Promise<void>;
  /** UPDATE by id inside `tx`. Returns the affected row count. */
  updateByIdTx: (tx: SqlExecutor, id: string) => Promise<number>;
  /** DELETE by id inside `tx`. Returns the affected row count. */
  deleteByIdTx: (tx: SqlExecutor, id: string) => Promise<number>;
}

function makeAdapters(): WriteAdapter[] {
  return [
    {
      table: "agent",
      seed: async (wsId) => {
        const id = createId();
        await f.sql.unsafe(
          `INSERT INTO agent (id, workspace_id, name, role, system_prompt, status)
           VALUES ($1, $2, $3, 'iso-w', 'sp', 'active')`,
          [id, wsId, `write-iso-agent-${id.slice(-6)}`]
        );
        return id;
      },
      insertWithWorkspaceTx: async (tx, id, workspaceId) => {
        await tx.unsafe(
          `INSERT INTO agent (id, workspace_id, name, role, system_prompt, status)
           VALUES ($1, $2, $3, 'iso-w', 'sp', 'active')`,
          [id, workspaceId, `inj-agent-${id.slice(-6)}`]
        );
      },
      updateByIdTx: async (tx, id) => {
        const r = await tx.unsafe(`UPDATE agent SET system_prompt='tampered' WHERE id=$1`, [id]);
        return getCount(r);
      },
      deleteByIdTx: async (tx, id) => {
        const r = await tx.unsafe(`DELETE FROM agent WHERE id=$1`, [id]);
        return getCount(r);
      },
    },
    {
      table: "conversation",
      seed: async (wsId) => {
        const id = createId();
        await f.sql.unsafe(
          `INSERT INTO conversation (id, workspace_id, status) VALUES ($1, $2, 'open')`,
          [id, wsId]
        );
        return id;
      },
      insertWithWorkspaceTx: async (tx, id, workspaceId) => {
        await tx.unsafe(
          `INSERT INTO conversation (id, workspace_id, status) VALUES ($1, $2, 'open')`,
          [id, workspaceId]
        );
      },
      updateByIdTx: async (tx, id) => {
        const r = await tx.unsafe(`UPDATE conversation SET status='closed' WHERE id=$1`, [id]);
        return getCount(r);
      },
      deleteByIdTx: async (tx, id) => {
        const r = await tx.unsafe(`DELETE FROM conversation WHERE id=$1`, [id]);
        return getCount(r);
      },
    },
    {
      table: "api_key",
      seed: async (wsId) => {
        const id = createId();
        await f.sql.unsafe(
          `INSERT INTO api_key (id, workspace_id, name, hashed_key, prefix)
           VALUES ($1, $2, $3, $4, 'iso_')`,
          [id, wsId, `write-iso-key-${id.slice(-6)}`, `hash-${id}`]
        );
        return id;
      },
      insertWithWorkspaceTx: async (tx, id, workspaceId) => {
        await tx.unsafe(
          `INSERT INTO api_key (id, workspace_id, name, hashed_key, prefix)
           VALUES ($1, $2, $3, $4, 'inj_')`,
          [id, workspaceId, `inj-key-${id.slice(-6)}`, `hash-${id}`]
        );
      },
      updateByIdTx: async (tx, id) => {
        const r = await tx.unsafe(`UPDATE api_key SET name='tampered' WHERE id=$1`, [id]);
        return getCount(r);
      },
      deleteByIdTx: async (tx, id) => {
        const r = await tx.unsafe(`DELETE FROM api_key WHERE id=$1`, [id]);
        return getCount(r);
      },
    },
    {
      table: "knowledge_base",
      seed: async (wsId) => {
        const id = createId();
        await f.sql.unsafe(
          `INSERT INTO knowledge_base (id, workspace_id, name) VALUES ($1, $2, $3)`,
          [id, wsId, `write-iso-kb-${id.slice(-6)}`]
        );
        return id;
      },
      insertWithWorkspaceTx: async (tx, id, workspaceId) => {
        await tx.unsafe(`INSERT INTO knowledge_base (id, workspace_id, name) VALUES ($1, $2, $3)`, [
          id,
          workspaceId,
          `inj-kb-${id.slice(-6)}`,
        ]);
      },
      updateByIdTx: async (tx, id) => {
        const r = await tx.unsafe(`UPDATE knowledge_base SET name='tampered' WHERE id=$1`, [id]);
        return getCount(r);
      },
      deleteByIdTx: async (tx, id) => {
        const r = await tx.unsafe(`DELETE FROM knowledge_base WHERE id=$1`, [id]);
        return getCount(r);
      },
    },
    {
      table: "feature_flag",
      seed: async (wsId) => {
        const id = createId();
        await f.sql.unsafe(
          `INSERT INTO feature_flag (id, workspace_id, flag_key, enabled)
           VALUES ($1, $2, $3, true)`,
          [id, wsId, `write-iso-flag-${id.slice(-6)}`]
        );
        return id;
      },
      insertWithWorkspaceTx: async (tx, id, workspaceId) => {
        await tx.unsafe(
          `INSERT INTO feature_flag (id, workspace_id, flag_key, enabled)
           VALUES ($1, $2, $3, true)`,
          [id, workspaceId, `inj-flag-${id.slice(-6)}`]
        );
      },
      updateByIdTx: async (tx, id) => {
        const r = await tx.unsafe(`UPDATE feature_flag SET enabled=false WHERE id=$1`, [id]);
        return getCount(r);
      },
      deleteByIdTx: async (tx, id) => {
        const r = await tx.unsafe(`DELETE FROM feature_flag WHERE id=$1`, [id]);
        return getCount(r);
      },
    },
    {
      table: "ai_provider",
      seed: async (wsId) => {
        const id = createId();
        await f.sql.unsafe(
          `INSERT INTO ai_provider (id, workspace_id, provider, api_key)
           VALUES ($1, $2, $3, 'enc-iso')`,
          [id, wsId, `write-iso-prov-${id.slice(-6)}`]
        );
        return id;
      },
      insertWithWorkspaceTx: async (tx, id, workspaceId) => {
        await tx.unsafe(
          `INSERT INTO ai_provider (id, workspace_id, provider, api_key)
           VALUES ($1, $2, $3, 'enc-inj')`,
          [id, workspaceId, `inj-prov-${id.slice(-6)}`]
        );
      },
      updateByIdTx: async (tx, id) => {
        const r = await tx.unsafe(`UPDATE ai_provider SET api_key='tampered' WHERE id=$1`, [id]);
        return getCount(r);
      },
      deleteByIdTx: async (tx, id) => {
        const r = await tx.unsafe(`DELETE FROM ai_provider WHERE id=$1`, [id]);
        return getCount(r);
      },
    },
  ];
}

/**
 * postgres-js returns a `Result` that's an array of rows AND carries
 * a `.count` for INSERT/UPDATE/DELETE. The type narrows to
 * `RowList<Row[]>` in v3 and `count` lives on the array. The
 * `unsafe` typings don't reflect the `count` field — cast through
 * unknown to read it.
 */
function getCount(r: unknown): number {
  const maybe = r as { count?: number };
  return maybe.count ?? 0;
}

beforeAll(async () => {
  f = await setupIsolation();
}, 60_000);

afterAll(async () => {
  await teardownIsolation(f);
  await teardownTestWorkspaces();
});

describe("Cross-tenant WRITE isolation matrix", () => {
  // The full matrix: 6 tables × {INSERT-reject, UPDATE-foreign,
  // DELETE-foreign, UPDATE-own sanity} = 24 assertions. Express it as
  // one it.each with the table as the parameter — all four arms in
  // the same case so a failure on UPDATE doesn't skip DELETE.
  const TABLES = [
    "agent",
    "conversation",
    "api_key",
    "knowledge_base",
    "feature_flag",
    "ai_provider",
  ];

  it.each(TABLES)(
    "%s: foreign-workspace INSERT rejected; foreign-row UPDATE/DELETE affect 0 rows",
    async (tableName) => {
      const adapters = makeAdapters();
      const adapter = adapters.find((a) => a.table === tableName);
      if (!adapter) throw new Error(`No adapter for table ${tableName}`);

      // 1. Seed one canary per workspace using cron_admin (bypasses RLS).
      const wsAId = await adapter.seed(f.wsA.id);
      const wsBId = await adapter.seed(f.wsB.id);

      // 2. INSERT with foreign workspace_id under wsA's context.
      //    Expected: Postgres raises "new row violates row-level
      //    security policy" inside the tx, causing rollback.
      const injectId = createId();
      await expect(
        withAppUserContext(f.sql, f.wsA.id, async (tx) => {
          await adapter.insertWithWorkspaceTx(tx, injectId, f.wsB.id);
        })
      ).rejects.toThrow(/row-level security|new row violates/i);

      // Belt-and-braces: under cron_admin, confirm the inject row never
      // actually landed (the rollback above should already guarantee this).
      const stillThere = await withCronAdminContext(f.sql, async (tx) => {
        const rows = await tx.unsafe(`SELECT id FROM ${tableName} WHERE id=$1`, [injectId]);
        return rows.length;
      });
      expect(stillThere).toBe(0);

      // 3. UPDATE of wsB's row from wsA's context. RLS USING filters
      //    the row out BEFORE the SET applies — 0 rows affected,
      //    no error. This is the route-layer "404 not found" surface.
      const updateAttempt = await withAppUserContext(f.sql, f.wsA.id, async (tx) => {
        return adapter.updateByIdTx(tx, wsBId);
      });
      expect(updateAttempt).toBe(0);

      // 4. DELETE of wsB's row from wsA's context — same semantics as
      //    UPDATE: USING filters before, so 0 rows deleted.
      const deleteAttempt = await withAppUserContext(f.sql, f.wsA.id, async (tx) => {
        return adapter.deleteByIdTx(tx, wsBId);
      });
      expect(deleteAttempt).toBe(0);

      // 5. wsB's row must STILL exist after the failed UPDATE/DELETE
      //    attempts. Verify via cron_admin (bypasses RLS).
      const survived = await withCronAdminContext(f.sql, async (tx) => {
        const rows = await tx.unsafe(`SELECT workspace_id FROM ${tableName} WHERE id=$1`, [wsBId]);
        return rows[0]?.["workspace_id"];
      });
      expect(survived).toBe(f.wsB.id);

      // 6. Sanity counter-test: wsA CAN update its OWN row from its
      //    own context. If this fails the test is misconfigured (e.g.
      //    GUC not set), not a real isolation problem.
      const ownUpdate = await withAppUserContext(f.sql, f.wsA.id, async (tx) => {
        return adapter.updateByIdTx(tx, wsAId);
      });
      expect(ownUpdate).toBe(1);
    },
    30_000 // Allow up to 30s per case — the 6 tx round-trips can add up.
  );
});
