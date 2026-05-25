import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@orchester/db";
import { safeLogError } from "@/lib/safe-log";

/**
 * Boot-time assertion that the deployed `DATABASE_URL` connects as a
 * Postgres role that is neither SUPERUSER nor BYPASSRLS.
 *
 * ## Why this exists
 *
 * The 2026-05-24 final audit (P0 — see
 * `docs/specs/audits/2026-05-24-mnemosyne-v1-final-audit.md` §1.b)
 * proved that the deployed app had been silently bypassing every
 * RLS+FORCE Pattern A policy on `mnemo_*` / `brain_*` / tenant tables,
 * because `DATABASE_URL` resolved to the `orchester` superuser
 * (`rolsuper=t, rolbypassrls=t`). Tenant isolation rested entirely on
 * application-level GUC discipline — one missing `set_config` would
 * have leaked rows across workspaces.
 *
 * ADR-0010 (defense in depth) commits us to running the app as
 * `app_user` (NOINHERIT LOGIN, no BYPASSRLS — defined in migration
 * `packages/db/migrations/0007_postgres_roles.sql`). This check is the
 * deploy-time tripwire that fails loud if production drifts back to a
 * superuser-tier credential.
 *
 * ## Behaviour
 *
 * - **`NODE_ENV === "production"`**: throws if the current Postgres
 *   user is `rolsuper=true` OR `rolbypassrls=true`. The thrown error
 *   propagates out of `instrumentation.ts` and the Node process exits
 *   non-zero — the deploy fails loudly instead of running with RLS
 *   off in prod.
 * - **Dev / test**: emits a `safeLogError` warning so the dev sees the
 *   audit-flagged misconfig in their console, but doesn't break local
 *   workflows that still use the bootstrap superuser URL.
 *
 * ## Operator verification
 *
 * Independently of this probe, an operator can confirm the deployed
 * role with:
 *
 *   psql "$DATABASE_URL" -c \
 *     "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;"
 *
 * Expected result on a healthy prod: `f | f`.
 */
export async function assertSafeDbRole(): Promise<void> {
  const db = getDb();

  // Query pg_roles for the current user's flags. `current_user` resolves
  // to the role the session is authenticated as (or, in our case, the
  // outermost role — there is no `SET ROLE` in scope at boot).
  const rows = (await db.execute(
    sql`SELECT current_user::text AS rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`
  )) as unknown as Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>;

  if (rows.length === 0) {
    // Defensive: pg_roles must contain current_user; if not, something
    // is very wrong. Treat the same as an unsafe role.
    const msg =
      "[db-role-check] FATAL: pg_roles lookup for current_user returned 0 rows. " +
      "Cannot confirm RLS+FORCE will apply — refusing to boot.";
    if (process.env["NODE_ENV"] === "production") throw new Error(msg);
    safeLogError("[db-role-check]", msg);
    return;
  }

  const { rolname, rolsuper, rolbypassrls } = rows[0]!;
  if (!rolsuper && !rolbypassrls) {
    // All clear. Layer 2 of defense-in-depth holds; layer 1 (the
    // SET LOCAL ROLE in tx wrappers) is the safety net.
    console.log(`[db-role-check] OK: connected as '${rolname}' (rolsuper=f, rolbypassrls=f)`);
    return;
  }

  const flagStr = `rolsuper=${rolsuper ? "t" : "f"}, rolbypassrls=${rolbypassrls ? "t" : "f"}`;
  const msg =
    `[db-role-check] DATABASE_URL is connected as '${rolname}' with ${flagStr}. ` +
    "This role bypasses RLS+FORCE Pattern A policies on every tenant-scoped " +
    "table (mnemo_*, brain_*). See ADR-0010 and the P0 finding in " +
    "docs/specs/audits/2026-05-24-mnemosyne-v1-final-audit.md §1.b. " +
    "Production MUST connect as `app_user` (migration 0007_postgres_roles.sql).";

  if (process.env["NODE_ENV"] === "production") {
    // Fail-closed in prod: the deploy aborts instead of running with
    // RLS effectively off. Layer 1 (tx-wrapper SET LOCAL ROLE) would
    // still cover most paths even if this check were skipped, but we
    // want the deploy to never reach the request-serving stage with
    // a superuser-tier credential.
    throw new Error(msg);
  }

  // Dev / test: warn but don't block. The tx wrappers' SET LOCAL ROLE
  // still keeps RLS effective for callers that go through them.
  safeLogError("[db-role-check]", msg);
}
