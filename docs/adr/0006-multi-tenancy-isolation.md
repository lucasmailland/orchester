# 0006. Multi-tenancy isolation strategy (L1 RLS)

- Status: Accepted (supersedes [0005](0005-app-layer-tenancy.md))
- Date: 2026-05-23

## Context

Orchester must scale to 10k+ tenants with strong isolation but low operational overhead. Four standard tenancy levels exist (L1 — pooled DB with logical isolation, L2 — pooled DB with schema-per-tenant, L3 — DB-per-tenant, L4 — cluster-per-tenant).

ADR-0005 originally chose application-layer filtering only. Phase A of the tenant hardening sub-spec re-evaluated and found that a single missed `eq(table.workspaceId, …)` or a future bug in the invariants linter is a single-failure-mode cross-tenant leak — unacceptable for an enterprise product.

See `docs/specs/2026-05-23-tenant-hardening-design.md` §2.

## Decision

Adopt **L1 logical row-level isolation**. Every tenant-scoped table carries a `workspace_id` foreign key. PostgreSQL RLS, with `FORCE ROW LEVEL SECURITY`, enforces isolation as a second barrier behind application-level filters (which we keep).

The tenant id is propagated to Postgres via the `app.workspace_id` GUC (see ADR-0013).

## Consequences

**Positive:** scales to many tenants in one DB cluster; cheaper than L2/L3; standard PostgreSQL feature set; defense in depth.
**Negative:** every connection must set the GUC; cross-tenant background work needs an explicit bypass; pooling requires `set_config(..., is_local=true)` inside transactions.
**Revisit when:** an Enterprise customer requests BYO database (then L3 as add-on).
