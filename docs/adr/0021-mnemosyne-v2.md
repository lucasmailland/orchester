# ADR-021 — Mnemosyne v2: pointer-indexed recall + learned dynamics

Date: 2026-05-26 · Status: Proposed

## Context

v1.6 (see ADR-020 amendment 2026-05-26) shipped the four primitives
(`mnemo_fact`, `mnemo_decision`, `mnemo_entity`, `mnemo_episode`), the
bitemporal GIST exclusion, halfvec-quantized HNSW (migration `0042`),
the L1→L2→L3 recall pipeline with HyDE + cross-encoder rerank, the
9-verb LOCKED graph, Memory Protocol v1.2 with actor isolation, and
the consolidation cron stack (prune, merge, summarize, archive).

Two external audits — `mempalace` (52.9k★ Python+ChromaDB store) and
`codegraph` (single-tenant SQLite code-graph MCP) — surfaced 13
concrete patterns we don't currently implement. They fall into three
buckets:

1. **Topology gaps.** Recall today runs L1 hot-cache → L2 HNSW vector
   → L3 query cache; there is no learned bias between L1 and L2. Each
   recall query pays the full vector cost even on hot topics. The
   pointer-index pattern from mempalace ("closets") inserts a compact
   `(topic, entities[], fact_ids[])` lookup tier that fan-outs to fact
   IDs before vector search runs.
2. **Dynamics gaps.** `mnemo_fact.confidence` is set once at extraction
   time and only mutated by candidate-on-write conflicts. There is no
   Hebbian potentiation on access, no Ebbinghaus decay tied to
   spacing-effect-aware stability, and the existing exponential-decay
   recency multiplier (ADR-019) operates on `updated_at`, not on a
   per-fact learned half-life. mempalace's strength/stability pair —
   Hebbian +0.05 on access, stability grows only when accesses are ≥1h
   apart (Cepeda) — replaces our static confidence with a learned
   recency/frequency model.
3. **Tactical hardening.** The remaining 11 ideas are smaller surface
   fixes: edge `provenance` (heuristic vs LLM-derived edges merit
   different recall weights), `mnemo_unresolved_mention` staging
   ("silent beats wrong" on ambiguous entity links), virtual line
   numbers on drawer reads so `→2026-01-18:L55-L72` citation spans
   survive re-extraction, query sanitization against prompt
   contamination, a sweeper job for prefilter-rejected turns, an
   inverted-interval defensive read guard, edge-recovery post-BFS,
   staleness banners on `mnemo_summary`, generated/triggered
   `text_lemmatized` (already done on `mnemo_fact`/`mnemo_decision` —
   the gap is on derived stores), co-location boost in rerank, and
   per-entity diversity caps in selection.

The v1.6 "True 10/10" audit closed every wire-up gap on the existing
surface. v2 is the next conceptual move, not a refactor.

## Decision

Mnemosyne v2 introduces two **architectural** changes and absorbs 11
**tactical** improvements:

**Architectural — the big move.**

1. A new table `mnemo_pointer` ("closets"), a denormalized fan-out
   index between L1 hot-cache and L2 HNSW. Rows hold
   `(topic, entities[], fact_ids[], strength, last_access_at)`. Recall
   consults `mnemo_pointer` FIRST by lemmatized topic match + entity
   overlap, fans out to `fact_ids` via `WHERE id = ANY($1)`, then
   re-enters the existing rerank pipeline. The pointer index is built
   lazily: extraction writes pointer rows when a fact arrives on a
   recurring topic; consolidation merges duplicates nightly. **Pointer
   misses fall through to existing L2 HNSW** — the table is a learned
   bias, never a correctness gate.

2. Hebbian + Ebbinghaus dynamics on `mnemo_fact`. Three new columns:
   `strength real DEFAULT 0.5` (Hebbian potentiation, +0.05 per
   recall, capped at 1.0), `stability real DEFAULT 1.0` (grows only
   when accesses are ≥1h apart — Cepeda spacing), `last_access_at
timestamptz`. Recall score multiplier becomes
   `strength · exp(-days_since_access / stability)` with a 0.05 floor,
   replacing the global half-life constant from ADR-019. The legacy
   `confidence` column stays for extraction-quality scoring; the new
   columns drive recall ranking.

**Tactical adds (no new architectural seams).** Edge `provenance`,
`mnemo_unresolved_mention` staging, virtual line numbering at READ,
query sanitization heuristic, sweeper-job for prefilter backfill,
inverted-interval defensive guard, edge-recovery post-BFS, staleness
banners on summaries, generated `text_lemmatized` on `mnemo_summary`
(plus a CHECK on `mnemo_entity.aliases`), co-location rerank boost,
per-entity diversity cap.

Protocol version bumps from v1.2 → v1.3 — only because the agent
contract grows a `stale_summary` field. Tool surface stays compatible.

`mnemo.v2.dynamics_enabled` and `mnemo.v2.pointer_index_enabled` are
both **feature-flag-gated workspace settings** so we can dark-launch.
ADR-010 Pattern A (FORCE RLS) and ADR-013 (GUC-based tenancy) apply
unchanged to the new tables.

## Consequences

**Positive.** (1) Recall latency on hot topics drops — pointer-index
lookups are b-tree scans on `(workspace_id, lemmatized_topic)`,
typically <1ms, before any HNSW probe. (2) Long-tail recall improves
because spacing-aware stability lets facts recalled across multiple
sessions float to the top, while one-shot facts decay naturally —
this is the missing piece that ADR-019's static half-life couldn't
capture. (3) Edge provenance lets us prune heuristic-derived edges
aggressively during consolidation without losing LLM-judged edges.
(4) Per-entity diversity caps + co-location boost together reduce
the "loud entity monopoly" failure mode seen in v1.5 dogfood logs.

**Negative.** (1) Writes get a fan-out cost — every commit must
maintain at least one pointer row. We expect ~1.2× write amplification,
mitigated by batching in the extract-job's existing flush window.
(2) Three new hot columns on `mnemo_fact` increase row width by ~24
bytes; on a 1M-fact workspace that's ~23MB additional heap. HNSW
index size unchanged. (3) Two new background jobs (pointer-merge,
prefilter-backfill-sweep) join the consolidation crons; pg-boss queue
pressure rises ~10%. (4) The dynamics columns need a backfill —
`strength := current_confidence`, `last_access_at := updated_at`,
`stability := 1.0` — runnable online but generating ~1M UPDATEs per
busy workspace.

**Neutral.** Storage baseline grows ~5% (pointer table is small;
dynamics columns are 24 bytes/row). Cold-recall compute is unchanged
because pointer-miss falls through to L2. Hot-recall compute drops.
PII pipeline, RLS posture, citation system, and protocol semantics
are untouched.

## Alternatives considered

- **Swap Postgres for a dedicated graph DB.** Rejected. ADR-003
  ("Postgres as only dependency") still holds; the gaps audit revealed
  are tractable inside our existing substrate, and a graph-DB swap
  would re-open every isolation and federation question we closed in
  ADR-006/010/012.
- **Single-tenant memory store** (the codegraph model — SQLite per
  workspace). Rejected on the same grounds: our multi-tenancy is a
  product invariant, not a deployment shape. Codegraph's _patterns_
  travel; its substrate doesn't.
- **Drop `confidence`, replace fully with `strength`.** Rejected.
  `confidence` is extraction-quality (a property of the LLM call that
  produced the fact); `strength` is recall-utility (a property of how
  the fact has performed since). Keep both, document the distinction
  in the protocol.
- **Make the pointer index the only recall path.** Rejected. The
  pointer index is a learned bias — empty pointer table on a fresh
  workspace must still recall correctly via L2. Pointer-miss
  fall-through is the explicit correctness contract.

## Migration strategy

Land additive, never destructive. Three commit windows:

1. **Phase A merges first (S-tier hardening).** Columns added with
   defaults, no reader behaviour changes. Old code paths keep working.
2. **Phase B merges next (M-tier tactical).** New tables
   (`mnemo_unresolved_mention`) join the RLS+FORCE regime from day
   one. Sweeper job is opt-in per workspace.
3. **Phase C merges last under feature flags.** `mnemo_pointer` and
   the dynamics columns ship behind workspace settings. Backfill cron
   runs in batches of 1000 rows / 30s sleep so it doesn't saturate
   pg-boss. Live recall continues reading the legacy path until the
   flag is flipped per workspace.

Dual-write window: extraction writes the pointer row when the flag is
on but recall still reads both legacy + pointer for 7 days, scoring
the latter zero. After 7 days of pointer hit-rate telemetry we
promote pointer-hit results into the rerank stage. v1.6 readers
remain functional throughout — the new columns are nullable, the new
tables are independent.

Rollback: dropping the feature flag stops new pointer writes; a 30-day
data-retention cron prunes the table if the flag stays off. The
dynamics columns can be left in place (zero cost when unread) or
dropped via a 0049 down-migration.

## Links

- Design context: `docs/specs/2026-05-24-mnemosyne-design.md`
  (§43-§45 v1.5/v1.6/v2.0 roadmap)
- Plan: `docs/specs/plans/2026-05-26-mnemosyne-v2.md`
- v1.6 audit: `docs/specs/audits/2026-05-26-mnemosyne-v1.6-final-audit.md`
- External source material:
  - mempalace — github.com/mempalace/mempalace (closets, dynamics)
  - codegraph — github.com/colbymchenry/codegraph (provenance, staging)
- Related ADRs: ADR-003 (Postgres-only), ADR-006 (multi-tenancy),
  ADR-010 (FORCE RLS Pattern A), ADR-013 (GUC tenancy),
  ADR-018 (HNSW choice), ADR-019 (exponential decay — superseded for
  recall ranking, retained for fallback), ADR-020 (Mnemosyne v1.0+
  v1.5+v1.6 amendments).
