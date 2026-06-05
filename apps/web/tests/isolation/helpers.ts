// apps/web/tests/isolation/helpers.ts
//
// Isolation-suite helpers for Phase C. We need to verify that with FORCE
// ROW LEVEL SECURITY enabled, no `app_user` connection can leak rows
// across tenants. The plan originally proposed `pg.Pool` with separate
// role-specific connection strings; we adapt to postgres-js + SET ROLE
// because:
//
//   1. The web app already depends on postgres-js (drizzle's postgres-js
//      driver). Pulling `pg` here would re-introduce the duplicate
//      `drizzle-orm` peer-resolution issue documented in
//      apps/web/tests/fixtures/db.ts.
//   2. The testcontainer is created with `postgres` superuser. Superuser
//      can `SET ROLE app_user` per session, which switches the effective
//      user for RLS checks WITHOUT needing to log in fresh as the role
//      (no password roundtrip, no extra pool).
//
// Pattern: every test issues a single BEGIN/SET LOCAL ROLE/SET LOCAL
// app.workspace_id/…/COMMIT envelope on a dedicated client. The LOCAL
// scope ensures the role/GUC vanish at COMMIT, so subsequent reservations
// of the same physical connection start clean.
import { setupTestWorkspaces, type WsFixture } from "../fixtures/workspaces";
import { getTestDbUrl } from "../fixtures/db";
import postgres from "postgres";

/**
 * Generic handle accepted by every helper that runs queries. Either a
 * top-level postgres-js `Sql` client OR a `TransactionSql` handed in by
 * `sql.begin(...)` works, because both expose `.unsafe(sql, params)`.
 */
export type SqlExecutor = Pick<ReturnType<typeof postgres>, "unsafe">;

export interface IsolationFixture {
  wsA: WsFixture;
  wsB: WsFixture;
  /**
   * Superuser client. Tests cycle through it with `withAppUserContext` /
   * `withCronAdminContext` to switch effective role per transaction.
   */
  sql: ReturnType<typeof postgres>;
}

export async function setupIsolation(): Promise<IsolationFixture> {
  const [wsA, wsB] = await setupTestWorkspaces();
  const url = getTestDbUrl();
  if (!url) throw new Error("setupTestDb must run before setupIsolation");
  // `max: 1` keeps every reservation on the same physical connection. With
  // a larger pool, RESET ROLE / LOCAL GUC handling is correct anyway, but
  // a single connection makes failures easier to reason about.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  return { wsA, wsB, sql };
}

export async function teardownIsolation(f: IsolationFixture): Promise<void> {
  await f.sql.end({ timeout: 5 });
}

/**
 * Run `fn` inside a transaction with effective role = app_user and
 * app.workspace_id = workspaceId. Both settings are SET LOCAL so they
 * release on COMMIT/ROLLBACK and don't leak to the next reservation.
 *
 * Returns whatever `fn` returns. Any thrown error rolls back the txn
 * and re-throws.
 */
export async function withAppUserContext<T>(
  sql: ReturnType<typeof postgres>,
  workspaceId: string,
  fn: (tx: SqlExecutor) => Promise<T>
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE app_user`);
    await tx.unsafe(`SELECT set_config('app.workspace_id', $1, true)`, [workspaceId]);
    return fn(tx);
  }) as Promise<T>;
}

/**
 * Run `fn` inside a transaction with effective role = cron_admin (BYPASSRLS).
 * Use this when the test needs the ground-truth total count of rows across
 * every workspace, ignoring RLS.
 */
export async function withCronAdminContext<T>(
  sql: ReturnType<typeof postgres>,
  fn: (tx: SqlExecutor) => Promise<T>
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE cron_admin`);
    return fn(tx);
  }) as Promise<T>;
}
