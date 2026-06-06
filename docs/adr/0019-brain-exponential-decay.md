# ADR-019 — Brain Core relevance decay: exponential with pin override

Date: 2026-05-24 · Status: Superseded by ADR-020 (Mnemosyne) on 2026-05-24, fully retired on 2026-06-05 (Phase 3 cut-over)

## Context

Facts get stale. "User likes morning standups" from 2 years ago should
not outrank "user moved to async-only" from last week. Without a decay
mechanism, the brain accumulates noise and slowly degrades recall.

Options:

1. No decay — keep all facts at full weight forever
2. Linear decay — `relevance' = relevance - 0.001 * days_unused`
3. Exponential — `relevance' = relevance * exp(-Δt / HALF_LIFE)`
4. Step-function — full weight for N days, then constant low weight

## Decision

Exponential decay with half-life 30 days, floor at 0.05, daily cron at
04:00 UTC:

```
relevance' = max(0.05, relevance * exp(-Δt_seconds / (30 * 86400)))
```

Pinned facts (`pinned = true`) are exempt — explicit operator intent
overrides automatic decay. Same for facts touched recently via
`markRecalled` (the formula reads `COALESCE(last_recalled_at, created_at)`,
so a recent recall resets the clock).

## Consequences

**Positive:** smooth decay, no cliff at the boundary. The 0.05 floor
keeps facts findable by direct subject lookup but pushes them below
the natural top-K hybrid recall threshold (~0.2-0.3 in practice).

**Negative:** facts that are still true but rarely recalled drift down.
Mitigation: pin them.

**Revisit when:** we add fact-decay configurability per `kind` (e.g.
preferences should decay slower than events). For v1 the single
half-life is acceptable.
