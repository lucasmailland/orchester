# 0010. RLS FORCE: defense in depth

- Status: Accepted
- Date: 2026-05-23

## Context

ADR-0006 chose to layer RLS underneath application-level tenant filters. Postgres ships RLS in two modes:

- **Permissive RLS** (the default): the table owner and any role with the `BYPASSRLS` attribute skip the policy entirely.
- **`FORCE ROW LEVEL SECURITY`**: even the table owner is subject to the policy. Only roles with `BYPASSRLS` (which we grant to exactly one internal role, `cron_admin`) can skip.

Without FORCE, a single migration that runs as the table owner could silently dump rows from every workspace. We want that to require a deliberate, audited gesture.

See `docs/specs/2026-05-23-tenant-hardening-design.md` §3.2.

## Decision

Every tenant-scoped table runs with `FORCE ROW LEVEL SECURITY`. The application connects as a normal role (`orchester_app`); only the `cron_admin` role (used by `withCrossTenantAdmin`) bypasses RLS, and only inside a transaction tagged with `app.cross_tenant_admin='true'` so the bypass is observable in `pg_stat_activity` and our logs.

22 tables are under FORCE as of Phase C completion.

## Consequences

**Positive:** even a buggy ORM, a manual migration, or a compromised app credential can't leak cross-tenant data; every cross-tenant access is explicitly named.
**Negative:** every connection that touches a tenant table MUST set the GUC first; one missed `set_config` shows up as "0 rows returned" which can look like an application bug.
**Revisit when:** Postgres ships a finer-grained RLS bypass (column-level, predicate-only).
