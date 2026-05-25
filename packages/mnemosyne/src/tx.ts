// packages/mnemosyne/src/tx.ts
//
// withMnemoTx — runs `fn` inside a transaction with `app.workspace_id`
// SET LOCAL'd. Required for all mnemo_* table operations because every
// mnemo_* table has RLS+FORCE Pattern A policies that gate on the GUC.
//
// §0.1: this file is package-clean — no `server-only`. The host app
// guards server-only execution at its own boundaries; mnemosyne stays
// Next.js-agnostic so it remains OSS-extractable.
import { sql } from "drizzle-orm";
import { getDb, type DbClient } from "@orchester/db";

type Tx = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/**
 * Open a transaction with both (a) the effective role downgraded to
 * `app_user` and (b) `app.workspace_id` set, so every `mnemo_*` query
 * inside is actually subject to RLS+FORCE Pattern A.
 *
 * ## Why `SET LOCAL ROLE app_user`?
 *
 * The 2026-05-24 final audit (P0 — see
 * `docs/specs/audits/2026-05-24-mnemosyne-v1-final-audit.md` §1.b)
 * proved that the deployed `DATABASE_URL` connects as the `orchester`
 * Postgres role — `rolsuper=t, rolbypassrls=t`. With BYPASSRLS on,
 * Pattern A policies are silently skipped: a missing `set_config` (or
 * any future bug) leaks rows across tenants instead of returning 0.
 * RLS+FORCE on the table is real, but on the wire it is theatre.
 *
 * `SET LOCAL ROLE app_user` downgrades the *transaction* to a role
 * that lacks BYPASSRLS (defined in migration 0007_postgres_roles.sql,
 * `NOINHERIT LOGIN`, no BYPASSRLS). Because it's LOCAL it auto-reverts
 * on COMMIT/ROLLBACK, so the next reservation of the same pooled
 * connection starts clean. This works even when the connection
 * itself is superuser — `SET ROLE` to a non-BYPASSRLS role applies
 * for the duration of the transaction regardless of how the session
 * was authenticated.
 *
 * This is layer 1 of a defense-in-depth fix; layer 2 is connecting
 * production directly as `app_user` (see ADR-0010 and the boot-time
 * `assertSafeDbRole` check in `apps/web/lib/db-role-check.ts`).
 */
export async function withMnemoTx<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // ── Layer 1 of defense-in-depth (audit P0, 2026-05-24): downgrade
    // the tx to `app_user` so RLS+FORCE actually applies even if the
    // connection role is BYPASSRLS. MUST precede the GUC set so
    // subsequent statements are already under the non-elevated role.
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  });
}

export type { Tx };
