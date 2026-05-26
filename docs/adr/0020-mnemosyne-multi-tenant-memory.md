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

> **Amendment 2026-05-25 (post-v1.4):** This ADR was written at v1.0
> design time and undercounted the v1.4 surface. See the "Amendment
> 2026-05-25 — v1.1 → v1.4 evolution" section at the end of this ADR
> for the up-to-date table list, verb list, and shipped extensions.

Concrete commitments:

- **Storage.** Six tables at v1.0 — `mnemo_fact`, `mnemo_decision`,
  `mnemo_relation`, `mnemo_citation`, `mnemo_extraction_job`,
  `mnemo_query_cache` — all RLS+FORCE (ADR-010 Pattern A). Tenant key is
  `workspace_id`. Bitemporal validity is captured via
  `(valid_from, valid_to)` GIST-indexed ranges on facts and decisions
  (migration `0026_mnemoyne_bitemporal_gist.sql`). v1.1–v1.4 add five
  more tables (`mnemo_summary`, `mnemo_fact_archive`, `mnemo_health`,
  `mnemo_review_queue`, `mnemo_episode`) — see the amendment below.
- **Recall.** Hybrid pgvector HNSW + Postgres FTS (same shape as
  `knowledge_chunk`, ADR-018). The relation graph is traversable via a
  recursive CTE over `mnemo_relation`; verbs are locked to a fixed set
  of 9 — `related`, `compatible`, `scoped`, `conflicts_with`,
  `supersedes`, `not_conflict`, `derived_from`, `part_of`, `member_of`.
  (See `packages/mnemosyne/src/graph/verbs.ts` — `RELATION_VERBS` is the
  single source of truth; the older list above of `relates_to`,
  `contradicts`, `supports`, `derives_from`, `assigned_to`, `blocks`,
  `mentions`, `references`, `succeeds` was a draft never deployed.)
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

## Amendment 2026-05-25 — v1.1 → v1.4 evolution

The original Decision section listed six tables and a (never-deployed)
draft verb list. The shipped v1.4 surface is:

**Tables — 11 mnemo\_\* + one column on `agent`:**

| Table                  | Migration | Role                                       |
| ---------------------- | --------- | ------------------------------------------ |
| `mnemo_fact`           | 0017      | Core fact primitive (+0033 memory_type,    |
|                        |           | +0035 attribution, +0037 actor_id)         |
| `mnemo_extraction_job` | 0017      | Extraction backlog                         |
| `mnemo_decision`       | 0018      | Decision primitive                         |
| `mnemo_relation`       | 0020      | Graph edges (9 LOCKED verbs)               |
| `mnemo_citation`       | 0021      | Source provenance                          |
| `mnemo_query_cache`    | 0022      | L3 cache — table provisioned, NOT wired    |
| `mnemo_summary`        | 0028      | v1.1 — distilled per-user profile          |
| `mnemo_fact_archive`   | 0029      | v1.2 — janitor + supersede graveyard       |
| `mnemo_health`         | 0031      | v1.2 — drift snapshots                     |
| `mnemo_review_queue`   | 0032      | v1.3 — active-learning queue               |
| `mnemo_episode`        | 0034      | v1.4 — episodic timeline                   |
| `agent.memory_policy`  | 0036      | jsonb column (not a new table) — per-agent |
|                        |           | recall/write policy applier                |

**LOCKED verb list (9 — `RELATION_VERB_VERSION = v1.0.0`):**

`related`, `compatible`, `scoped`, `conflicts_with`, `supersedes`,
`not_conflict`, `derived_from`, `part_of`, `member_of`.

Source of truth: `packages/mnemosyne/src/graph/verbs.ts`. Re-ordering or
changing any string in the array is a breaking protocol bump that
invalidates every stored judgment (see header doc-comment in that file).

**Memory Protocol** — v1.0.0 frozen at v1.0; v1.1 introduced a compact
~80-token variant (`MEMORY_PROTOCOL_V1`) plus the legacy ~300-token
form (`MEMORY_PROTOCOL_V1_LEGACY`) retained for back-compat. The
version string stayed `v1.0.0` because tool surface + semantics did not
break; the change was prompt-length only.

**Operational mode reframing** — Mode A is no longer a configuration
target. Live provider-health degradation can push a Mode-C workspace
down to A/B mid-turn (circuit breaker). `resolveActiveMode` is the
runtime answer; `resolveConfiguredMode` answers the static-config
question. See `src/modes/{detect,health}.ts`.

**Cumulative roadmap milestones:**

- v1.1 "The Brain" — quality + cost (HyDE, rerank, prune, compact
  render, contradiction-on-write, tiered injection, prompt-caching,
  async embedding, distilled summary cron).
- v1.2 "The Janitor" — `mnemo_fact_archive`, bitemporal `asOf`,
  health-snapshot drift detection, dedup + prune crons.
- v1.3 "The Inspector" — 11 API routes under `/api/mnemo/*`,
  `mnemo_review_queue` + active-learning sweep, auto-pin rules,
  Inspector UI.
- v1.4 "The Cognitive Leap" — memory_type, episodes,
  attribution, 1-hop graph expansion in recall, REM-style
  consolidation, per-agent memory policy, actor_id, unified KB+Memory
  recall.

Full evolution detail in `docs/specs/2026-05-24-mnemosyne-design.md`
§40 (added 2026-05-25).

## Links

- Design: `docs/specs/2026-05-24-mnemosyne-design.md` (§40 evolution,
  §41 deferred, §42 v1.4 snapshot)
- Plan: `docs/specs/plans/2026-05-24-mnemosyne-implementation-plan.md`
- Initial audit: `docs/specs/audits/2026-05-24-mnemosyne-v1-final-audit.md`
- Final audit: `docs/specs/audits/2026-05-25-mnemosyne-v1.4-final-audit.md`
- Related: ADR-006 (app-layer tenancy), ADR-010 (RLS+FORCE),
  ADR-014..019 (brain_core), ADR-012 (cross-tenant admin wrapper).
