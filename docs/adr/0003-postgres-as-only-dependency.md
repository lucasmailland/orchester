# 0003. Postgres as the only required runtime dependency

- Status: Accepted
- Date: 2026-05-22

## Context

Most platforms in this space accumulate a runtime topology that looks something like: app + relational DB + Redis + queue + vector DB + object store. Each component is individually justifiable. Together they're a substantial operational burden — every self-hoster has to run them, every cloud bill has line items for them, every outage has more places to look.

We want to optimize for **self-hosters with limited operational appetite** as the default case. Cloud-scale operators can always split components out later; small teams cannot easily collapse them.

Postgres 15 with the `pgvector` extension can do, _adequately_, the work people typically split across:

- Application database (obvious).
- Job queue, via `pg-boss` — Postgres SKIP LOCKED has been production-quality for queue workloads for many years.
- Vector store, via `pgvector` — supports HNSW indexes, good enough up to tens of millions of vectors per workspace.
- Cache and rate-limit store, via straightforward table writes with TTL columns — slower than Redis but adequate for the request volumes we target before a tenant becomes a "cloud operator" anyway.

The cost is real: each of these is _less performant_ in Postgres than in the purpose-built tool. The benefit is also real: there is nothing else to install, configure, monitor, or back up.

## Decision

**Postgres is the only required runtime dependency.** A self-host install runs on `pnpm install`, `docker run postgres:15-pgvector`, and `pnpm migrate`. Nothing else.

Optional add-ons may improve performance but never _replace_ the Postgres-based path:

- **Redis** for rate limiting at high request volumes. If absent, the in-memory limiter in `lib/rate-limit.ts` handles single-process deploys; the Postgres limiter handles multi-process.
- **Object storage** (S3-compatible) for file attachments. If absent, attachments live on local disk — fine for single-node, breaks for horizontal scale.
- **A separate vector DB** (Pinecone, Weaviate, etc.) is _not_ supported. pgvector is the only KB backend. This is a deliberate restriction, not an oversight.

A new feature that requires a new runtime component is a design red flag. If the value is worth the cost, it needs an ADR superseding this one.

## Consequences

**Positive.** Single-component install. Single backup. Single failure domain for ops. Migrations are atomic across "queue" and "data". The same Postgres can host the dev DB and prod DB, with the same code paths.

**Negative.** Performance ceilings are lower than a multi-component stack at scale. pg-boss as a queue is slower than Kafka/SQS/Redis Streams. pgvector is slower than Pinecone/Qdrant past a certain index size. We accept these ceilings and document them; tenants who hit them have outgrown the default deployment shape.

**Watch for.** If queue latency under sustained load becomes a routine complaint, we revisit. If pgvector indexes become a maintenance burden at our actual usage distribution, we revisit. Until then, the simplification is worth the ceiling.

## Alternatives considered

- **Postgres + Redis baseline.** Rejected as the default — Redis adds an operational component that's overkill for the default deploy. Redis remains supported as an _optional_ upgrade.
- **Postgres + dedicated queue (e.g., BullMQ on Redis, Temporal).** Rejected for the default. Temporal in particular is excellent but adds substantial operational footprint.
- **Postgres + dedicated vector DB.** Rejected. The split forces tenants to manage two stores in sync. pgvector is good enough for our scale targets.
