# 0005. Tenant filtering at the application layer (not RLS)

- Status: Accepted
- Date: 2026-05-22

## Context

Orchester is multi-tenant from the foundation. Every domain row has a `workspace_id`. Two reasonable ways to enforce that no query ever returns rows from the wrong workspace:

1. **Postgres Row-Level Security (RLS).** Define policies on every multi-tenant table; set `app.current_workspace_id` as a session variable on every connection; let the database refuse to return rows that don't match. Strong default, defense-in-depth, hard to bypass — even a buggy ORM query can't leak.
2. **Application-layer filtering.** Every query carries an explicit `eq(table.workspaceId, workspaceId)` predicate. The database has no opinion; correctness is the application's job.

RLS is the more conservative choice. It has real costs at our scale:

- Drizzle (our ORM) doesn't natively model RLS — we'd be combining typed queries with raw SQL session setup.
- Connection pooling (pgbouncer, Supabase pooler, Neon proxy) interacts badly with `SET LOCAL`. We'd need to drop transaction-pooling mode or wrap every query in an explicit transaction.
- Debugging "why is this query returning empty?" gets one layer harder because the filter is invisible in the query text.
- RLS protects against bugs in _our own code_, which is a real threat — but we have another mechanism (the structural invariants guard) that catches the same class of bug at PR review time, before it ships.

We considered RLS seriously. The deciding factor was the invariants guard: it grep-enforces, against every PR, that no new multi-tenant query is missing its `workspaceId` predicate. That's a structural defense at the same level as RLS, with much lower operational cost.

## Decision

**Tenant filtering is the application's responsibility, enforced structurally by [`scripts/audit-invariants.sh`](../../scripts/audit-invariants.sh).**

The invariants guard fails the build if a new query against a workspace-scoped table is missing the `workspaceId` predicate. The list of workspace-scoped tables lives in the script and is reviewed when the schema changes.

We do not use Postgres RLS. We do not set per-request session variables.

## Consequences

**Positive.** Simpler operational topology — any pooler, any connection mode, no per-request session setup. Queries are self-explanatory in the source. Adding a new multi-tenant table is one entry in the invariants script.

**Negative.** A subtle bug that _passes the invariants guard but is still wrong_ (e.g. wrong join condition that ignores the predicate's effect) would leak data. RLS would catch that. We accept this risk and mitigate with:

1. Code review — workspace-touching queries get review attention.
2. Tests — the most sensitive tables have integration tests that explicitly assert "workspace A cannot see workspace B's rows".
3. Audit log — every sensitive mutation is recorded; cross-workspace anomalies become detectable post-hoc.

**Watch for.** If we ship a tenancy bug that leaks across workspaces, this ADR gets superseded by one introducing RLS as defense-in-depth. The structural guard alone is sufficient _until that day_. The day a leak happens, the calculus changes.

## Alternatives considered

- **RLS only.** Rejected for the operational reasons above.
- **RLS plus application-layer filtering ("belt and suspenders").** Rejected for now — the operational cost is the same as RLS alone, and the marginal protection over invariants-guard + app-layer filtering is small at our current threat model. Worth reconsidering as scale grows.
- **No structural enforcement, rely on reviewers.** Rejected — humans miss things, the guard catches them.
