# 0012. Cron tasks use `withCrossTenantAdmin` for explicit cross-tenant access

- Status: Accepted
- Date: 2026-05-23

## Context

Several background jobs legitimately span workspaces: the orphan-run reaper, the daily audit chain verifier, the hard-delete reaper, the usage aggregator. They cannot run inside a single workspace's tenant context — they iterate.

The naive solution: give those jobs `BYPASSRLS` on their connection. That's silent — nothing in the log distinguishes a legitimate sweep from a malicious leak.

See `docs/specs/2026-05-23-tenant-hardening-design.md` §3.6.

## Decision

All cross-tenant background work runs inside `withCrossTenantAdmin(reason, fn)`. The wrapper:

1. Opens a transaction on the `cron_admin` role (which has `BYPASSRLS`).
2. Sets `app.cross_tenant_admin='true'` GUC (visible in `pg_stat_activity`).
3. Logs a structured JSON line tagged `tenant.cross_tenant_admin.bypass` with the human-readable `reason`.
4. Passes the transaction handle (`tx`) to the callback — callbacks MUST issue queries on `tx`, not `getDb()`.

The bypass is auditable: every cross-tenant access produces a log line and an audit row.

## Consequences

**Positive:** zero ambient cross-tenant access — every bypass is named, logged, and time-bounded; reviewer can `grep "cross_tenant_admin"` to enumerate the call sites.
**Negative:** background-job authors must remember to use `tx` not `getDb()`; we accept a runtime warning in the log when this is missed.
**Revisit when:** Postgres ships per-transaction `BYPASSRLS` (then we can drop the dedicated role).
