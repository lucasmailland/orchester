# ADR-020 — Mnemosyne: multi-tenant memory architecture

Date: 2026-05-24 · Status: Accepted

## Context

`brain_core` (v1.1, see ADR-014 through ADR-019) gave Orchester a single
tenant-scoped fact store with hybrid recall and exponential decay. It got
us through the early product, but four gaps blocked the multi-tenant SaaS
ambition:

1. **No graph layer.** Facts are bag-of-statements. The product needs
   relations between entities ("X reports to Y", "ticket A blocks ticket B")
   that recall can traverse, not just match.
2. **No first-class citations.** Every extracted fact should point at the
   source span and the extractor that produced it, so we can audit "why
   does the model think X?" and invalidate extractions when an extractor
   prompt changes.
3. **No federation hook.** brain_core assumes one workspace per facts row.
   We need to be able to (later) federate read-only across workspaces
   without rewriting the recall path.
4. **Cost coupling.** Any LLM-side enrichment was implicit: extraction
   ran on the platform's keys. The SaaS contract is BYO LLM keys — the
   platform must charge $0 for memory in the baseline path.

A fifth concern (cross-tenant isolation) was already addressed by ADR-006
and ADR-010, but those mechanisms only matter if the new tables join the
RLS+FORCE regime from day one rather than being retrofitted.

See `docs/specs/2026-05-24-mnemosyne-design.md` for the full design and
`docs/specs/plans/2026-05-24-mnemosyne-implementation-plan.md` for the
phased rollout.

## Decision

Introduce a new package `@orchester/mnemosyne` — Postgres-only at v1.0,
no new infrastructure. The package owns six tables and one set of public
APIs (`commit`, `recall`, `relate`, `cite`).

Concrete commitments:

- **Storage.** Six tables — `mnemo_fact`, `mnemo_decision`,
  `mnemo_relation`, `mnemo_citation`, `mnemo_extraction_job`,
  `mnemo_query_cache` — all RLS+FORCE (ADR-010 Pattern A). Tenant key is
  `workspace_id`. Bitemporal validity is captured via
  `(valid_from, valid_to)` GIST-indexed ranges on facts and decisions
  (migration `0026_mnemoyne_bitemporal_gist.sql`).
- **Recall.** Hybrid pgvector HNSW + Postgres FTS (same shape as
  `knowledge_chunk`, ADR-018). The relation graph is traversable via a
  recursive CTE over `mnemo_relation`; verbs are locked to a fixed set
  of 9 — `relates_to`, `contradicts`, `supports`, `derives_from`,
  `assigned_to`, `blocks`, `mentions`, `references`, `succeeds`.
- **Protocol.** `MEMORY_PROTOCOL_VERSION = "v1.0.0"` is frozen. The
  string is injected into the agent system prompt at runtime by
  `apps/web/lib/agent-runtime.ts` so every agent has a stable contract
  about when to call `mnemosyne_commit`, `mnemosyne_recall`, etc.
  Bumping the version invalidates extractions tagged with the prior
  version (see design spec §13).
- **Three operational modes.**
  - **Mode A — $0 DB-only.** No embeddings, no LLM enrichment. Recall
    is FTS + exact match on subject. This is the default and the only
    mode the platform itself pays for.
  - **Mode B — Embedding.** Customer's own embedding key drives the
    vector column. No platform cost.
  - **Mode C — Full AI.** Customer's own keys drive both embeddings and
    LLM-side extraction/judging.
- **Provider Agnosticism Charter §25.** No hardcoded provider or model
  string in any operational path. Every adapter resolves via the
  workspace's `ai_provider_credential` row. Audit script
  `scripts/audit-invariants.sh` enforces the spend-cap and metering
  invariants for any future `llmCall`/`llmStream` in
  `packages/mnemosyne/src/`.

`brain_core` stays in place for back-compat. Migration `0024` pre-stages
the eventual cutover by backfilling `mnemo_fact` from `brain_fact` rows
that survive Phase 1; the live read path keeps reading both until Phase 2
removes `brain_core`.

## Consequences

**Positive.** Multi-tenant from day one — six new tables enter the
RLS+FORCE regime without any retrofitting. The graph layer unblocks
relation-aware recall (a hard requirement for the agent runtime road
map). Citations are first-class, so "why does the model think X?" has a
deterministic answer. Mode A means the baseline path costs the platform
nothing per workspace — pricing can decouple from LLM costs.

**Negative.** Two memory backends (`brain_core` + `mnemosyne`) coexist
through Phase 1 — recall has to merge, and dual-write costs an extra
INSERT per turn. The bitemporal range index (GIST on `tstzrange`) is
heavier than the b-tree on `created_at` we used in brain_core; on cold
data the difference is negligible, on hot churn it's measurable
(benchmark in plan §8.2). Nine locked verbs is a deliberate constraint
— if the product needs a tenth, it's a coordinated bump of the protocol
version, not an ad-hoc column.

**Revisit when.** (1) Any workspace passes 10M facts — at that point the
HNSW vs. IVFFlat trade-off (ADR-018) flips. (2) Federation across
workspaces becomes a paid feature — the read path has the seams but the
RLS posture needs an explicit cross-tenant wrapper (ADR-012 pattern).
(3) A provider ships a primitive that subsumes both `mnemo_fact` and
`mnemo_relation` — collapse the schema then, not before.

## Links

- Design: `docs/specs/2026-05-24-mnemosyne-design.md`
- Plan: `docs/specs/plans/2026-05-24-mnemosyne-implementation-plan.md`
- Final audit: `docs/specs/audits/2026-05-24-mnemosyne-v1-final-audit.md`
- Related: ADR-006 (app-layer tenancy), ADR-010 (RLS+FORCE),
  ADR-014..019 (brain_core), ADR-012 (cross-tenant admin wrapper).
