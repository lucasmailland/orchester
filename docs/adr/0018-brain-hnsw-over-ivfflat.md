# ADR-018 — Brain Core ANN index: HNSW over IVFFlat

Date: 2026-05-24 · Status: Superseded by ADR-020 (Mnemosyne) on 2026-05-24, fully retired on 2026-06-05 (Phase 3 cut-over)

## Context

pgvector ships two ANN index types: HNSW (Hierarchical Navigable Small
Worlds) and IVFFlat (Inverted File with Flat compression).

HNSW: faster queries, slower builds, better recall@k. Read-heavy.
IVFFlat: faster builds, less recall, needs to be retrained after big writes.

Brain Core is **read-heavy by design** — every conversation turn fires a
recall query (potentially several with `brain_recall` tool calls), but
writes are at most a handful per extraction job (~1 per turn). Ratio is
roughly 50:1 read:write.

## Decision

HNSW with `m=16, ef_construction=64` — same params as `knowledge_chunk`
(proven well-balanced for our embedding shapes).

## Consequences

**Positive:** sub-10ms recall queries on ≤100K facts/workspace. No
periodic re-index needed.

**Negative:** index build is ~10x slower than IVFFlat — bulk fact
imports (backfill job, sub-spec 5+) will be noticeably slow. Mitigation:
build the index AFTER bulk load via `REINDEX CONCURRENTLY` rather than
inserting facts into an HNSW-indexed table.

**Revisit when:** any workspace exceeds 10M facts (HNSW's break-even
with IVFFlat in our benchmarks).
