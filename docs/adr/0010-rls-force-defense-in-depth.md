# 0010. RLS FORCE: defense in depth

- Status: Accepted
- Date: 2026-05-23
- Amended: 2026-05-25 (P0 audit finding — see §"Amendment 2026-05-25" below)

## Context

ADR-0006 chose to layer RLS underneath application-level tenant filters. Postgres ships RLS in two modes:

- **Permissive RLS** (the default): the table owner and any role with the `BYPASSRLS` attribute skip the policy entirely.
- **`FORCE ROW LEVEL SECURITY`**: even the table owner is subject to the policy. Only roles with `BYPASSRLS` (which we grant to exactly one internal role, `cron_admin`) can skip.

Without FORCE, a single migration that runs as the table owner could silently dump rows from every workspace. We want that to require a deliberate, audited gesture.

See `docs/specs/2026-05-23-tenant-hardening-design.md` §3.2.

## Decision

Every tenant-scoped table runs with `FORCE ROW LEVEL SECURITY`. The application connects as a normal role (`app_user`, defined in `packages/db/migrations/0007_postgres_roles.sql` — `NOINHERIT LOGIN PASSWORD 'app'`, no BYPASSRLS); only the `cron_admin` role (used by `withCrossTenantAdmin`) bypasses RLS, and only inside a transaction tagged with `app.cross_tenant_admin='true'` so the bypass is observable in `pg_stat_activity` and our logs.

22 tables are under FORCE as of Phase C completion.

## Consequences

**Positive:** even a buggy ORM, a manual migration, or a compromised app credential can't leak cross-tenant data; every cross-tenant access is explicitly named.
**Negative:** every connection that touches a tenant table MUST set the GUC first; one missed `set_config` shows up as "0 rows returned" which can look like an application bug.
**Revisit when:** Postgres ships a finer-grained RLS bypass (column-level, predicate-only).

## Amendment 2026-05-25: P0 audit finding 2026-05-24 — defense-in-depth fix

### What was wrong

The 2026-05-24 final audit (`docs/specs/audits/2026-05-24-mnemosyne-v1-final-audit.md` §1.b) discovered that the original "Decision" above was aspirational, not operational. Live verification against the deployed Postgres cluster showed:

```
rolname     | rolsuper | rolbypassrls
------------+----------+--------------
orchester   | t        | t
app_user    | f        | f
cron_admin  | f        | t
```

- The deployed `DATABASE_URL` connected as `orchester` — a `SUPERUSER` with `BYPASSRLS=t`. The role `orchester_app` referenced by the original ADR text did not exist (drift); the correct non-BYPASSRLS role is `app_user` from migration 0007.
- Every Pattern A RLS policy on `mnemo_*` and `brain_*` tables was silently skipped by the deployed app: `relrowsecurity=t, relforcerowsecurity=t` was correct at the schema layer, but the connecting role bypassed it unconditionally.
- `withMnemoTx`, `withBrainTx`, and `withTenantContext` set `app.workspace_id` but never switched the effective role. Only test helpers (`apps/web/tests/isolation/helpers.ts:72,88` and `packages/mnemosyne/tests/integration/cross-tenant-isolation.spec.ts:66`) called `SET LOCAL ROLE app_user`, so the green isolation suite proved nothing about production.

Net effect: tenant isolation rested entirely on application-level GUC discipline. A single missing `set_config('app.workspace_id', …)` would have silently leaked rows across workspaces instead of returning the empty set RLS+FORCE was supposed to guarantee.

### What was fixed

Two layers, both must hold:

1. **Layer 1 — `SET LOCAL ROLE app_user` inside every tx wrapper.** Added to `withMnemoTx` (`packages/mnemosyne/src/tx.ts`), `withBrainTx` (`apps/web/lib/brain/store.ts`), and `withTenantContext` (`apps/web/lib/tenant/context.ts`). Issued before the `set_config('app.workspace_id', …)` so every statement in the transaction runs under a non-BYPASSRLS role. `SET LOCAL` reverts on COMMIT/ROLLBACK, so pooled connections don't carry the elevation across callers. This works even when the connection itself is superuser.

2. **Layer 2 — connection-string updates + boot-time role check.** `.env.example` now points runtime at `app_user:app`. Operators must deploy `app_user` (not `orchester`) as the app credential and keep a separate `MIGRATION_DATABASE_URL` (or out-of-band tooling) for the elevated migration role. A new boot probe `apps/web/lib/db-role-check.ts` (`assertSafeDbRole`) is invoked from `apps/web/instrumentation.ts` on `NEXT_RUNTIME === "nodejs"`. In production it throws — and the Node process exits non-zero — if `rolsuper` OR `rolbypassrls` is true for `current_user`. In dev/test it warns via `safeLogError` so developers see the misconfig without blocking local workflows.

### How operators verify in production

Run, against the deployed cluster, using the same `DATABASE_URL` the app uses:

```
psql "$DATABASE_URL" -c \
  "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;"
```

A healthy deployment returns:

```
 rolsuper | rolbypassrls
----------+--------------
 f        | f
```

Any `t` in either column means the deployment is back in the "RLS theatre" state. The boot check should already have failed the deploy before this matters — but the manual probe is the ground-truth verification.

## SEC-16 note: `app_user` password must come from a secret manager

The `app_user` role was created with a static password (`'app'`) in migration 0007 to simplify local development. **In production, you must rotate this password** and source it from your secret manager (e.g. AWS Secrets Manager, Vault, Doppler). Hard-coding the password in `DATABASE_URL` defeats Layer 2 of the defense-in-depth — an attacker who can read the connection string gets a working credential with `BYPASSRLS=f` (the unprivileged role), which is the safe side, but still enables them to connect directly and read their own workspace's data without going through the API.

Operator checklist:

1. After deploy, run `ALTER ROLE app_user PASSWORD '<strong-random-password>'` using a privileged migration credential.
2. Update `DATABASE_URL` in your secret manager with the new password.
3. Restart the app; the boot probe at `apps/web/lib/db-role-check.ts` will confirm the connection still authenticates successfully with the non-BYPASSRLS role.
