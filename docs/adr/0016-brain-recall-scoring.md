# ADR-016 — Brain Core recall: hybrid scoring

Date: 2026-05-24 · Status: Accepted

## Context

Pure cosine-similarity recall is a known-bad default: it boosts
keyword-similar but stale facts above lower-similarity but currently-
relevant ones. The user-facing problem is "agent remembered something
true from a year ago but missed last week's preference change".

## Decision

Hybrid score, computed per-fact at query time:

```
score = 0.50 * semantic    (cosine)
      + 0.15 * recency     (exp(-age_days / 30))
      + 0.10 * frequency   (log(1 + hit_count) / log(100))
      + 0.20 * relevance   (decay-adjusted, see ADR-019)
      + 0.05 * pin_bonus   (1.0 if pinned else 0)
```

Weights sum to 1.0. SQL computes them in the SELECT alongside the
pgvector `<=>` operator so we sort by combined score in a single query.

## Consequences

**Positive:** newer + recently-recalled + pinned facts naturally surface
above stale ones. The weights are tunable per workspace later via
`feature_flag` overrides.

**Negative:** mathematically opinionated — different teams might want
different weights. Today they're hard-coded.

**Revisit when:** workspace operators ask for per-agent recall tuning.
