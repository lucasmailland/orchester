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
/**
 * Mnemosyne v1.6 — the rich-options form of `withMnemoTx`. Pass this
 * to opt into per-actor isolation (sets `app.actor_id` + flips the
 * `app.enforce_actor_isolation` GUC consumed by the policy added in
 * migration 0040).
 *
 * Plain `workspaceId: string` callers keep working unchanged via the
 * function overload — see below.
 */
export interface MnemoTxOptions {
  workspaceId: string;
  /**
   * v1.6 — the end-user (User.id) this transaction speaks for. When
   * set together with `enforceActorIsolation: true`, the SELECT
   * policy on `mnemo_fact` (migration 0040) restricts visible rows to
   * `actor_id IS NULL OR actor_id = $actorId`.
   *
   * When unset (or empty string), the GUC is not touched and per-
   * actor isolation collapses to a no-op even if
   * `enforceActorIsolation` is true.
   */
  actorId?: string | null;
  /**
   * v1.6 — flip the `app.enforce_actor_isolation` GUC to `'true'` so
   * the SELECT policy on `mnemo_fact` from migration 0040 actually
   * filters rows. Defaults to false to preserve every existing
   * caller's read scope. See the per-user privacy paragraph of the
   * Memory Protocol v1.2 text for the user-facing semantics.
   */
  enforceActorIsolation?: boolean;
}

/**
 * Open a transaction with both (a) the effective role downgraded to
 * `app_user` and (b) `app.workspace_id` set, so every `mnemo_*` query
 * inside is actually subject to RLS+FORCE Pattern A.
 *
 * Two call shapes:
 *   • `withMnemoTx(workspaceId, fn)` — legacy form, unchanged.
 *   • `withMnemoTx({ workspaceId, actorId?, enforceActorIsolation? }, fn)`
 *     — v1.6 form that additionally sets `app.actor_id` and/or
 *     `app.enforce_actor_isolation` GUCs.
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
export function withMnemoTx<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
export function withMnemoTx<T>(opts: MnemoTxOptions, fn: (tx: Tx) => Promise<T>): Promise<T>;
export function withMnemoTx<T>(
  arg: string | MnemoTxOptions,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  // Normalize both call shapes into a single options bag so the
  // transaction body branches once on optional GUCs instead of twice
  // on the overload.
  const opts: MnemoTxOptions = typeof arg === "string" ? { workspaceId: arg } : arg;
  const db = getDb();
  return db.transaction(async (tx) => {
    // ── Layer 1 of defense-in-depth (audit P0, 2026-05-24): downgrade
    // the tx to `app_user` so RLS+FORCE actually applies even if the
    // connection role is BYPASSRLS. MUST precede the GUC set so
    // subsequent statements are already under the non-elevated role.
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${opts.workspaceId}, true)`);
    // ── v1.6 per-actor isolation (migration 0040) ───────────────────
    // `app.actor_id` carries the end-user this transaction speaks for.
    // The SELECT policy on `mnemo_fact` consults it via
    // `current_setting('app.actor_id', true)` and restricts visible
    // rows when `app.enforce_actor_isolation = 'true'`. Both GUCs are
    // LOCAL so they release on COMMIT/ROLLBACK and never leak to the
    // next reservation of the same pooled connection.
    //
    // Empty-string actor_id is treated the same as unset — we don't
    // want to gate visibility on a sentinel value that could
    // accidentally equal a real id in a malformed row.
    if (opts.actorId && opts.actorId.length > 0) {
      await tx.execute(sql`SELECT set_config('app.actor_id', ${opts.actorId}, true)`);
    }
    if (opts.enforceActorIsolation === true) {
      await tx.execute(sql`SELECT set_config('app.enforce_actor_isolation', 'true', true)`);
    }
    return fn(tx);
  });
}

export type { Tx };
