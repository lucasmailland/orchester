# Architecture Decision Records

This directory holds the record of architecturally significant decisions made on Orchester. Each ADR is a short markdown file numbered sequentially, never deleted, sometimes superseded.

## Why ADRs

Most decisions in a codebase are invisible by the time the next person arrives. ADRs make the reasoning durable: not just _what_ was chosen but _what alternatives were considered_, _why this one_, and _what we'd watch for that would invalidate the call_.

If you find yourself answering "wait, why did we do it this way?" the answer should be in here.

## When to write one

Write an ADR when:

- The decision affects more than one file or module.
- The decision is _reversible only at significant cost_.
- The decision has explicit alternatives that someone reasonable might prefer.

Don't write one for:

- Implementation details that are local to one file.
- Decisions that are obviously dictated by an external constraint (language version, framework choice already made).
- Code style choices — those go in linter config or the contributing guide.

## Format

Each ADR follows the structure in [`0001-record-architecture-decisions.md`](0001-record-architecture-decisions.md). Keep them short — most should fit on one screen. The point is the _reasoning_, not the prose.

## Lifecycle

An ADR has one of these statuses:

- **Proposed** — drafted, not yet ratified by maintainers.
- **Accepted** — current. The decision is in force.
- **Superseded by NNNN** — an explicit later ADR replaced this one. The newer ADR links back; we never delete superseded records.
- **Deprecated** — the decision is no longer in force but no replacement is canonical. Rare.

Status changes happen by PR. Superseding ADRs must reference the one they replace.

## Index

| #    | Title                                                                                    | Status             |
| ---- | ---------------------------------------------------------------------------------------- | ------------------ |
| 0001 | [Record architecture decisions](0001-record-architecture-decisions.md)                   | Accepted           |
| 0002 | [License under Apache 2.0 (not MIT)](0002-apache-2-0-over-mit.md)                        | Accepted           |
| 0003 | [Postgres as the only required runtime dependency](0003-postgres-as-only-dependency.md)  | Accepted           |
| 0004 | [Developer Certificate of Origin instead of a CLA](0004-dco-over-cla.md)                 | Accepted           |
| 0005 | [Tenant filtering at the application layer (not RLS)](0005-app-layer-tenancy.md)         | Superseded by 0006 |
| 0006 | [Multi-tenancy isolation strategy (L1 RLS)](0006-multi-tenancy-isolation.md)             | Accepted           |
| 0007 | [Audit log: tamper-evident hash chain](0007-audit-log-hash-chain.md)                     | Accepted           |
| 0008 | [URL path includes workspaceSlug](0008-workspace-slug-in-url.md)                         | Accepted           |
| 0009 | [Workspace lifecycle: soft-delete with 30-day window](0009-soft-delete-30-day-window.md) | Accepted           |
| 0010 | [RLS FORCE: defense in depth](0010-rls-force-defense-in-depth.md)                        | Accepted           |
| 0011 | [Active workspace via cookie](0011-active-workspace-cookie.md)                           | Accepted           |
| 0012 | [`withCrossTenantAdmin` for cross-tenant cron jobs](0012-cross-tenant-admin-wrapper.md)  | Accepted           |
| 0013 | [Tenant context propagated via Postgres GUC](0013-tenant-context-via-guc.md)             | Accepted           |
