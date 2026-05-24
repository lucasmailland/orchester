# 0013. Tenant context propagated via Postgres GUC (`app.workspace_id`)

- Status: Accepted
- Date: 2026-05-23

## Context

RLS policies need a per-connection variable they can read in their `USING` clause. Postgres offers two mechanisms: session-level GUCs (set with `SET`) and transaction-local GUCs (`set_config(..., is_local=true)`). For pooled connections (pgbouncer, Supabase pooler), session-level GUCs leak across requests — a tenant-A query could end up running on a connection still holding tenant-B's GUC.

Other options considered: pass the tenant id explicitly in every query (verbose, error-prone), or per-request connection (kills pooling).

See `docs/specs/2026-05-23-tenant-hardening-design.md` §3.6.

## Decision

Tenant context is propagated via the `app.workspace_id` GUC. Two patterns are valid:

1. **Inside a transaction** (preferred for mutations): `set_config('app.workspace_id', <id>, true)` — local to the transaction, releases at COMMIT.
2. **On the pooled connection** (acceptable for read-only server-component fetches): `set_config(..., false)` after authenticating the user.

`getCurrentWorkspaceBySlug` calls the second variant. `withCrossTenantAdmin` and `appendAuditSync` both call the first variant explicitly. Background workers use `withCrossTenantAdmin` (which also sets `app.cross_tenant_admin`).

## Consequences

**Positive:** RLS policies are 1-liners; pgbouncer transaction-pooling stays compatible; explicit boundary between authenticated paths and bypasses.
**Negative:** a missed `set_config` shows up as "0 rows" — confusing to debug. We mitigate via the `recordTenantContextMissing` telemetry counter (alerts trip if non-zero in prod).
**Revisit when:** Postgres adds per-connection context that survives pooling natively.
