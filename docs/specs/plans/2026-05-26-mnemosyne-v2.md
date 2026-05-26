# Mnemosyne v2 — Implementation Plan

> **Status:** drafted 2026-05-26 against branch `mnemo-v1.4-graph-rem-tom`
> at commit `6eb02c4`. v1.6 is shipped (12 `mnemo_*` tables, migrations
> 0017→0042). This plan consolidates the 13 findings from the
> mempalace + codegraph audits into a phased, task-decomposed rollout.
>
> See ADR-021 for the architectural rationale. This document is the
> "how" — exact files, exact migrations, exact tests.

**Estimated total:** ~4.5 weeks of focused work (1 week Phase A + 1.5
weeks Phase B + 2 weeks Phase C). Parallelizable across 2 engineers
down to ~3 calendar weeks.

**Critical-path order:** Phase A (correctness hardening, low risk) →
Phase B (new tables and jobs) → Phase C (architectural — feature
flags, dark launch, backfill).

**Migration numbering.** Last shipped is `0042_mnemosyne_halfvec.sql`.
This plan claims `0043`–`0055`. Numbers are reserved per task; do not
reuse if a task is dropped.

**Feature flags introduced.**

- `mnemo.v2.dynamics_enabled` — workspace setting (default `false`).
- `mnemo.v2.pointer_index_enabled` — workspace setting (default `false`).
- `mnemo.v2.sweeper_enabled` — workspace setting (default `false`).

All three are read via the existing `workspace_setting` jsonb column
(per ADR-013 GUC model). No new app config.

---

## Phase A — Quick wins (1 week, S-tier)

Eight independent S-tier tasks. Each can ship as a standalone PR; no
hard dependencies between them. Land in any order. All eight target a
single `mnemo-v2-phase-a` integration branch then merge once green.

### A.1 — Virtual line numbering for citations

**Goal.** Preserve `→YYYY-MM-DD:L55-L72` citation spans across
re-extraction by applying `[N]` line prefixes at READ time only,
never at storage.

**Files.**

- `packages/mnemosyne/src/recall/render.ts` — add `withVirtualLines()`
  helper, wire into `renderFact` output path.
- `packages/mnemosyne/src/citation/store.ts` — extend `createCitation`
  to accept `lineSpan: { from: number, to: number }`.
- `packages/db/migrations/0043_mnemosyne_citation_linespan.sql` — new.

**Schema changes.**

```sql
-- 0043_mnemosyne_citation_linespan.sql
ALTER TABLE mnemo_citation
  ADD COLUMN line_from integer,
  ADD COLUMN line_to   integer,
  ADD CONSTRAINT mnemo_citation_linespan_ck
    CHECK (line_from IS NULL OR line_to IS NULL OR line_from <= line_to);

CREATE INDEX idx_mnemo_citation_linespan
  ON mnemo_citation (workspace_id, source_kind, source_id)
  WHERE line_from IS NOT NULL;
```

**Code changes.**

- `withVirtualLines(text: string): string` — splits on `\n`, prepends
  `[N] ` to each line, no storage side-effect.
- `renderFact()` in `recall/render.ts` calls it when the recall
  caller passes `renderLineNumbers: true`.

**Test.** `packages/mnemosyne/tests/unit/recall-render.test.ts` — add
`virtual line numbering preserves span on re-extraction` assertion:
seed a fact, render twice with `renderLineNumbers: true`, assert the
`[N]` prefix is deterministic and identical across renders.

**Effort.** S (4h). **Dependencies.** None.

### A.2 — Query sanitization vs prompt contamination

**Goal.** Detect 2k-char system prompts leaking into recall queries
and strip them with a pure-heuristic cascade. No LLM call.

**Files.**

- `packages/mnemosyne/src/recall/query-prep.ts` — add
  `sanitizeQuery(raw: string): string` BEFORE the existing
  `prepareQuery` cascade.
- `packages/mnemosyne/tests/unit/query-prep.test.ts` — new file.

**Schema changes.** None.

**Migration filename.** None — code-only.

**Code changes.** The cascade, exactly as the mempalace heuristic:

1. If `raw.length <= 200`, pass-through.
2. Else, extract the last question-shaped sentence
   (`/[^.!?]+\?\s*$/m`).
3. Else, take the last 250 characters as the tail.
4. Always trim and collapse whitespace.

Wire `sanitizeQuery` as the first line of `prepareQuery` in
`query-prep.ts:23`.

**Test.** `packages/mnemosyne/tests/unit/query-prep.test.ts` —
assertions:

- `sanitizeQuery("short query")` → unchanged.
- `sanitizeQuery("You are a helpful assistant... 2k chars... What is
the user's birthday?")` → returns `"What is the user's birthday?"`.
- `sanitizeQuery(<2k chars no question>)` → returns last 250 chars.
- No allocation when input ≤200 chars.

**Effort.** S (3h). **Dependencies.** None.

### A.3 — Inverted-interval defensive read guard

**Goal.** Belt-and-suspenders. The GIST exclusion in `0026` prevents
inverted intervals being _written_; this guards every _read_ against
historical bad rows.

**Files.**

- `packages/mnemosyne/src/recall/search.ts:464` — extend the
  `temporal filter` SQL fragment.
- `packages/mnemosyne/src/primitives/fact.ts:listFacts` — same guard.

**Schema changes.** None. (Optionally, an EXCLUDE constraint already
exists on `mnemo_fact`. The guard is a defensive read filter only.)

**Migration filename.** None — code-only.

**Code changes.** Wrap every `valid_to`-related WHERE clause with an
extra predicate. Concretely, the fragment at
`packages/mnemosyne/src/recall/search.ts:414-415` becomes:

```ts
const temporalFilter = input.asOf
  ? sql`AND valid_from <= ${input.asOf}
        AND (valid_to IS NULL OR valid_to > ${input.asOf})
        AND (valid_to IS NULL OR valid_to >= valid_from)`
  : sql`AND (valid_to IS NULL OR valid_to > now())
        AND (valid_to IS NULL OR valid_to >= valid_from)`;
```

Apply the same trailing predicate to `mnemo_relation` reads (it has
its own `valid_from`/`valid_to` per migration `0020:33-34`).

**Test.** `packages/mnemosyne/tests/integration/fact-crud.spec.ts` —
add `inverted interval defense`: manually INSERT a bad row via
super-user, assert the recall path excludes it.

**Effort.** S (2h). **Dependencies.** None.

### A.4 — Edge `provenance` column on `mnemo_relation`

**Goal.** Distinguish LLM-derived edges (high recall weight) from
heuristic ones (alias-merge, coreference). Codegraph idea #7.

**Files.**

- `packages/db/migrations/0044_mnemosyne_relation_provenance.sql` — new.
- `packages/db/src/schema/mnemosyne.ts` — add `provenance` column.
- `packages/mnemosyne/src/graph/relation.ts` — every insert path
  must pass `provenance`.
- `packages/mnemosyne/src/consolidation/cluster.ts` — prune
  `heuristic` edges more aggressively (threshold drops 0.5 → 0.3).
- `packages/mnemosyne/src/recall/search.ts:expandWithGraph` — weight
  heuristic edges at 0.5× during BFS scoring.

**Schema changes.**

```sql
-- 0044_mnemosyne_relation_provenance.sql
ALTER TABLE mnemo_relation
  ADD COLUMN provenance text NOT NULL DEFAULT 'heuristic'
    CHECK (provenance IN ('llm','heuristic','user','system'));

-- Partial index so the recall planner can fast-path
-- provenance='llm' edges without scanning heuristic ones.
CREATE INDEX idx_mnemo_rel_provenance_llm
  ON mnemo_relation (workspace_id, source_kind, source_id, provenance)
  WHERE provenance = 'llm';

-- Backfill: every existing row was llm-derived (we never had
-- a heuristic path). Update before relying on the DEFAULT.
UPDATE mnemo_relation SET provenance = 'llm';
ALTER TABLE mnemo_relation ALTER COLUMN provenance DROP DEFAULT;
```

**Code changes.** `relation.ts:createRelation` gains a required
`provenance` argument. Aliases-merge and coreference paths in
`entity/store.ts` use `'heuristic'`; the LLM judge path uses
`'llm'`; the Inspector UI uses `'user'`; consolidation crons use
`'system'`.

**Test.** `packages/mnemosyne/tests/integration/relation-crud.spec.ts`
— add `provenance gated weight in expansion`: seed one `llm` and one
`heuristic` edge with identical endpoints; assert the `llm` edge
contributes 2× the rerank weight.

**Effort.** S (6h). **Dependencies.** None (but if A.7 below ships
first, the BFS edge-recovery query MUST pre-filter on provenance to
avoid mass-importing heuristic noise).

### A.5 — Edge recovery post-BFS

**Goal.** After L1+L2 candidate selection, run one query to discover
relations _within_ the candidate set that BFS missed because we hit
the depth limit. Codegraph idea #9.

**Files.**

- `packages/mnemosyne/src/recall/search.ts:expandWithGraph` — add
  the recovery query AFTER the recursive CTE returns.

**Schema changes.** None. The existing
`idx_mnemo_rel_source (workspace_id, source_kind, source_id)` covers
the lookup.

**Migration filename.** None — code-only.

**Code changes.** Single new query block:

```ts
// After expandWithGraph picks the L1+L2 candidate IDs:
const candidateIds = candidates.map((c) => c.id);
if (candidateIds.length > 1) {
  const intra = await tx.execute<RelationRow>(sql`
    SELECT source_id, target_id, relation, confidence, provenance
    FROM mnemo_relation
    WHERE workspace_id = ${workspaceId}
      AND source_kind = 'fact' AND target_kind = 'fact'
      AND source_id = ANY(${candidateIds})
      AND target_id = ANY(${candidateIds})
      AND (valid_to IS NULL OR valid_to > now())
  `);
  // Apply +0.05 reinforcement boost to scoreMap[edge.target_id]
  // when edge.source_id is already in the result set.
}
```

Gate on A.4 if A.4 is already merged — filter `provenance != 'heuristic'`
during the recovery step to avoid mass-importing alias noise.

**Test.** `packages/mnemosyne/tests/integration/recall-expand-graph.spec.ts`
— add `intra-candidate edge recovery`: seed 3 facts with a relation
between fact #1 and fact #3 (depth >1 from query entity); assert
both end up in results with reinforced scores.

**Effort.** S (4h). **Dependencies.** A.4 (soft — if A.4 ships first,
filter heuristic edges; otherwise no filter needed).

### A.6 — Staleness banners on `mnemo_summary`

**Goal.** Mark a summary stale when its source facts changed after
`last_verified_at`. Surfaces in the agent injection contract.

**Files.**

- `packages/db/migrations/0045_mnemosyne_summary_staleness.sql` — new.
- `packages/db/src/schema/mnemosyne.ts` — add columns.
- `packages/mnemosyne/src/summary/store.ts` — write `source_hash`
  and `last_verified_at` on every summary write.
- `packages/mnemosyne/src/summary/distill.ts` — compute
  `source_hash` from the sorted concat of source-fact IDs and
  their `updated_at` timestamps.
- `packages/mnemosyne/src/recall/render.ts` — surface `stale: true`
  in the rendered summary banner when source facts have moved.

**Schema changes.**

```sql
-- 0045_mnemosyne_summary_staleness.sql
ALTER TABLE mnemo_summary
  ADD COLUMN source_hash      text,
  ADD COLUMN last_verified_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX idx_mnemo_summary_last_verified
  ON mnemo_summary (workspace_id, last_verified_at);

-- Backfill once: existing summaries are considered fresh as of
-- the migration's apply time.
UPDATE mnemo_summary
  SET source_hash      = md5(array_to_string(source_fact_ids, ',')),
      last_verified_at = generated_at
  WHERE source_hash IS NULL;
```

**Code changes.** Staleness check is a single query in
`renderFact()` / `renderSummary()`:

```ts
const stale = await tx.execute(sql`
  SELECT EXISTS (
    SELECT 1 FROM mnemo_fact
    WHERE workspace_id = ${workspaceId}
      AND id = ANY(${summary.source_fact_ids})
      AND updated_at > ${summary.last_verified_at}
  ) AS stale
`);
```

Result is folded into the agent injection contract as a top-level
`stale: boolean` field. Protocol v1.2 → v1.3 bump (cosmetic only —
agents that ignore the field still function).

**Test.** `packages/mnemosyne/tests/integration/summary.spec.ts` —
add `staleness banner surfaces when source facts mutate`: seed a
summary, update one source fact, recall, assert `stale: true`.

**Effort.** S (5h). **Dependencies.** None.

### A.7 — Trigger-managed `text_lemmatized` on derived stores

**Goal.** `mnemo_fact` and `mnemo_decision` already use
`GENERATED ALWAYS AS (...) STORED` (see migration `0017:33`). Audit
finding #11 surfaces the gap on derived stores: `mnemo_summary`
keeps `summary_text` but no `tsvector`, so summary-text search
doesn't exist; if we add summary search later, a trigger-maintained
column avoids application drift.

**Files.**

- `packages/db/migrations/0046_mnemosyne_summary_lemmatized.sql` — new.
- `packages/db/src/schema/mnemosyne.ts` — re-export the column.

**Schema changes.**

```sql
-- 0046_mnemosyne_summary_lemmatized.sql
ALTER TABLE mnemo_summary
  ADD COLUMN text_lemmatized tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(summary_text, ''))
  ) STORED;

CREATE INDEX idx_mnemo_summary_fts
  ON mnemo_summary USING gin (text_lemmatized);
```

**Code changes.** None at this phase. The column exists, the index
exists; callers that want summary search can use them.

**Test.** `packages/mnemosyne/tests/integration/summary.spec.ts` —
assert the column is non-null after insert and matches a probe
`to_tsquery('simple', 'foo')` after writing `"foo bar baz"`.

**Effort.** S (2h). **Dependencies.** None.

### A.8 — Per-entity diversity cap in selection

**Goal.** Cap each `entity_id` and `episode_id` at ~25% of the recall
budget so a loud entity (e.g. the current user) can't crowd out other
relevant facts. mempalace idea #13.

**Files.**

- `packages/mnemosyne/src/recall/search.ts` — add post-rerank
  diversity pass `enforceDiversity()` before the hard cap.

**Schema changes.** None.

**Migration filename.** None — code-only.

**Code changes.** New function in `recall/search.ts`:

```ts
function enforceDiversity(
  hits: ScoredHit[],
  maxResults: number,
  capPct = 0.25
): ScoredHit[] {
  const perEntityCap = Math.max(1, Math.ceil(maxResults * capPct));
  const perEpisodeCap = perEntityCap;
  const entityCounts = new Map<string, number>();
  const episodeCounts = new Map<string, number>();
  return hits.filter((h) => {
    const e = h.entity_id ?? "_none";
    const ep = h.episode_id ?? "_none";
    if ((entityCounts.get(e) ?? 0) >= perEntityCap) return false;
    if ((episodeCounts.get(ep) ?? 0) >= perEpisodeCap) return false;
    entityCounts.set(e, (entityCounts.get(e) ?? 0) + 1);
    episodeCounts.set(ep, (episodeCounts.get(ep) ?? 0) + 1);
    return true;
  });
}
```

Wire into `searchMnemo` between the rerank stage and the
`maxResults` truncation.

**Test.** `packages/mnemosyne/tests/integration/recall-search.spec.ts`
— add `diversity cap enforces 25% per entity`: seed 20 facts on
entity X and 5 on entity Y; recall with `maxResults: 8`; assert no
more than 2 facts from entity X in the result.

**Effort.** S (3h). **Dependencies.** None.

---

## Phase B — Tactical adds (1.5 weeks, M-tier)

Three M-tier tasks. Each introduces either a new table or a new
background job. Land sequentially within a single
`mnemo-v2-phase-b` branch.

### B.1 — Sweeper job for message-grain backfill

**Goal.** Re-examine turns that `shouldExtract` rejected, with a
relaxed threshold. Cursor-resumable, keyed by
`(session_id, message_uuid)`. mempalace idea #5.

**Files.**

- `packages/db/migrations/0047_mnemosyne_prefilter_sweep.sql` — new.
- `apps/web/worker/mnemosyne-sweeper-job.ts` — new pg-boss handler.
- `packages/mnemosyne/src/extraction/prefilter.ts` — export a
  relaxed-threshold variant `shouldExtractRelaxed`.
- `apps/web/lib/agent-runtime.ts` — enqueue sweeper jobs on a 6h
  cron when `mnemo.v2.sweeper_enabled` is true.

**Schema changes.**

```sql
-- 0047_mnemosyne_prefilter_sweep.sql
CREATE TABLE mnemo_prefilter_cursor (
  id              text PRIMARY KEY,
  workspace_id    text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  last_message_id text NOT NULL,
  last_swept_at   timestamptz NOT NULL DEFAULT now(),
  facts_recovered integer NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, conversation_id)
);

CREATE INDEX idx_mnemo_prefilter_cursor_workspace
  ON mnemo_prefilter_cursor (workspace_id, last_swept_at);

ALTER TABLE mnemo_prefilter_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_prefilter_cursor FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_prefilter_cursor');
GRANT SELECT, INSERT, UPDATE, DELETE ON mnemo_prefilter_cursor TO app_user;
```

**Code changes.** Sweeper job logic in
`apps/web/worker/mnemosyne-sweeper-job.ts`:

1. SELECT messages newer than `last_message_id` for this conversation.
2. Re-run `shouldExtractRelaxed` (lowers the heuristic threshold by
   ~30%).
3. For each newly-recovered message, enqueue an `extract-job` with
   `source: 'sweeper'` so analytics can attribute recovered facts.
4. UPSERT the cursor with the new `last_message_id` and
   `facts_recovered += N`.

Idempotent: re-running on the same cursor is a no-op. Sweeper runs
in 6h cycles per conversation when the workspace flag is on.

**Test.** `packages/mnemosyne/tests/integration/sweeper.spec.ts` —
new file. Assertions:

- Conversation with 5 messages where 3 fail the strict prefilter but
  2 pass the relaxed one; sweeper enqueues exactly 2 extract jobs.
- Re-running the sweeper without new messages enqueues nothing.
- Cursor row gets `facts_recovered = 2`.

**Effort.** M (2 days). **Dependencies.** None.

### B.2 — `mnemo_unresolved_mention` staging table

**Goal.** Ambiguous entity mentions go to a staging table with
candidate IDs in jsonb instead of being linked greedily. When
confidence stays low, feed `mnemo_review_queue`. "Silent beats
wrong." Codegraph idea #8.

**Files.**

- `packages/db/migrations/0048_mnemosyne_unresolved_mention.sql` — new.
- `packages/mnemosyne/src/entity/store.ts` — new
  `stageUnresolvedMention()`; existing `findOrCreate` calls it when
  the LLM confidence is between 0.3 and 0.7.
- `packages/mnemosyne/src/review/queue.ts` — enqueue review when a
  mention sits in staging >24h with confidence <0.5.

**Schema changes.**

```sql
-- 0048_mnemosyne_unresolved_mention.sql
CREATE TABLE mnemo_unresolved_mention (
  id              text PRIMARY KEY,
  workspace_id    text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  mention_text    text NOT NULL,
  source_fact_id  text REFERENCES mnemo_fact(id) ON DELETE CASCADE,
  candidate_ids   jsonb NOT NULL DEFAULT '[]'::jsonb,
                    -- [{ entity_id: text, score: real, reason: text }]
  confidence      real CHECK (confidence BETWEEN 0 AND 1),
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','resolved','dismissed')),
  resolved_to     text REFERENCES mnemo_entity(id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mnemo_unresolved_status
  ON mnemo_unresolved_mention (workspace_id, status, created_at)
  WHERE status = 'pending';

CREATE INDEX idx_mnemo_unresolved_source_fact
  ON mnemo_unresolved_mention (workspace_id, source_fact_id);

ALTER TABLE mnemo_unresolved_mention ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_unresolved_mention FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_unresolved_mention');
GRANT SELECT, INSERT, UPDATE, DELETE ON mnemo_unresolved_mention TO app_user;
```

**Code changes.** `entity/store.ts:findOrCreate` gains a third
return state — `{ status: 'unresolved', mentionId }` — when the LLM
disambiguator reports candidate scores in the [0.3, 0.7] band. The
extract-job links the fact to `entity_id = NULL` and writes the
mention row; recall path can still find the fact by text but won't
get the graph boost. After 24h, the auto-resolution cron checks
the row: if confidence climbed (e.g. more mentions arrived and
reinforced one candidate), resolve; otherwise enqueue review.

**Test.** `packages/mnemosyne/tests/integration/unresolved-mention.spec.ts`
— new file. Assertions:

- LLM returns candidates `[{ e1: 0.55, e2: 0.45 }]`: a row appears
  in `mnemo_unresolved_mention`, fact has `entity_id = NULL`.
- Second occurrence reinforces e1 to 0.85: row resolves, fact
  back-links to e1.
- 24h without resolution: row appears in `mnemo_review_queue`.

**Effort.** M (3 days). **Dependencies.** None.

### B.3 — Co-location boost in rerank

**Goal.** Multi-entity-match multiplier before the cross-encoder.
Facts sharing `episode_id` or `entity_id` reinforce each other.
mempalace idea #12.

**Files.**

- `packages/mnemosyne/src/recall/rerank.ts` — new
  `applyCoLocationBoost(hits)` step before cross-encoder rerank.
- `packages/mnemosyne/src/recall/search.ts` — call new step at the
  appropriate pipeline stage.

**Schema changes.** None.

**Migration filename.** None — code-only.

**Code changes.** New function in `rerank.ts`:

```ts
export function applyCoLocationBoost(
  hits: ScoredHit[],
  boost = 0.15
): ScoredHit[] {
  const entityCounts = new Map<string, number>();
  const episodeCounts = new Map<string, number>();
  for (const h of hits) {
    if (h.entity_id)
      entityCounts.set(h.entity_id, (entityCounts.get(h.entity_id) ?? 0) + 1);
    if (h.episode_id)
      episodeCounts.set(
        h.episode_id,
        (episodeCounts.get(h.episode_id) ?? 0) + 1
      );
  }
  return hits.map((h) => {
    const e = h.entity_id ? (entityCounts.get(h.entity_id) ?? 1) : 1;
    const ep = h.episode_id ? (episodeCounts.get(h.episode_id) ?? 1) : 1;
    const mult = 1 + boost * Math.log2(Math.max(e, ep));
    return { ...h, score: h.score * mult };
  });
}
```

Wire into `recall/search.ts:searchMnemo` between the FTS/vector
union and the cross-encoder call.

**Test.** `packages/mnemosyne/tests/integration/recall-rerank.spec.ts`
— add `co-location boost lifts shared-entity facts`: seed 5 facts
on entity X (with low individual scores) and 1 fact on entity Y
(with high individual score); assert at least 2 entity-X facts
appear in top-3.

**Effort.** M (1 day). **Dependencies.** A.8 should land first so
diversity cap doesn't fight co-location boost; otherwise the
ordering matters less but the test fixtures are cleaner.

---

## Phase C — Architectural moves (2 weeks, M+)

Two big bets. Both ship behind workspace feature flags. Land in a
dedicated `mnemo-v2-phase-c` branch with explicit dark-launch
telemetry (pointer-hit rate, dynamics-vs-static recall MRR delta).

### C.1 — "Closets" pointer index

**Goal.** Denormalized fan-out table between L1 and L2. The
load-bearing recall change. mempalace idea #1.

**Files.**

- `packages/db/migrations/0049_mnemosyne_pointer.sql` — new.
- `packages/db/src/schema/mnemosyne.ts` — new table re-export.
- `packages/mnemosyne/src/recall/pointer.ts` — new module:
  `getPointerCandidates`, `upsertPointerForFact`.
- `packages/mnemosyne/src/recall/search.ts` — pointer lookup
  BEFORE the L2 HNSW probe (feature-flagged).
- `packages/mnemosyne/src/primitives/fact.ts` — `createFact` calls
  `upsertPointerForFact` when the flag is on.
- `apps/web/worker/mnemosyne-pointer-merge-job.ts` — nightly
  consolidation cron that merges duplicate pointer rows by topic.

**Schema changes.**

```sql
-- 0049_mnemosyne_pointer.sql
--
-- "Closets" pointer index. Compact (topic, entities[], fact_ids[])
-- rows that act as a learned bias between L1 hot-cache and L2 HNSW.
-- Recall consults this table FIRST by lemmatized-topic match +
-- entity overlap; misses fall through to L2 unchanged.

CREATE TABLE mnemo_pointer (
  id                 text PRIMARY KEY,
  workspace_id       text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  topic              text NOT NULL,
  topic_lemmatized   tsvector GENERATED ALWAYS AS (
                       to_tsvector('simple', coalesce(topic, ''))
                     ) STORED,
  entity_ids         text[] NOT NULL DEFAULT '{}',
  fact_ids           text[] NOT NULL DEFAULT '{}',
  strength           real NOT NULL DEFAULT 0.5
                       CHECK (strength BETWEEN 0 AND 1),
  last_access_at     timestamptz NOT NULL DEFAULT now(),
  access_count       integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, topic)
);

CREATE INDEX idx_mnemo_pointer_topic_fts
  ON mnemo_pointer USING gin (topic_lemmatized);

CREATE INDEX idx_mnemo_pointer_entities
  ON mnemo_pointer USING gin (entity_ids);

CREATE INDEX idx_mnemo_pointer_last_access
  ON mnemo_pointer (workspace_id, last_access_at DESC);

CREATE OR REPLACE FUNCTION mnemo_pointer_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mnemo_pointer_updated_at
  BEFORE UPDATE ON mnemo_pointer
  FOR EACH ROW EXECUTE FUNCTION mnemo_pointer_set_updated_at();

ALTER TABLE mnemo_pointer ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_pointer FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_pointer');
GRANT SELECT, INSERT, UPDATE, DELETE ON mnemo_pointer TO app_user;
```

**Code changes.**

- `packages/mnemosyne/src/recall/pointer.ts` exports:
  - `getPointerCandidates(workspaceId, query, entityIds, tx)` —
    runs the FTS + GIN lookup, returns top-N pointers by
    `strength * log(1 + access_count)`. Concatenates and dedupes
    their `fact_ids` arrays, returns `string[]`.
  - `upsertPointerForFact(fact, tx)` — derives `topic` from the
    fact's `subject` or `entity_id`, INSERTs new pointer row or
    appends to `fact_ids` on existing topic.
- `recall/search.ts` adds a new stage AFTER L1 hot-cache and
  BEFORE L2:

  ```ts
  if (await isFlagOn(workspaceId, "mnemo.v2.pointer_index_enabled", tx)) {
    const pointerFactIds = await getPointerCandidates(
      workspaceId,
      query,
      prepared.entityIds,
      tx
    );
    if (pointerFactIds.length > 0) {
      // Fan out to facts by id, splice into the candidate set
      // BEFORE the vector probe. L2 still runs (pointer is bias,
      // not gate); pointer hits get a +0.1 score additive.
    }
  }
  ```

- `primitives/fact.ts:createFact` calls `upsertPointerForFact`
  inside the same transaction.
- `apps/web/worker/mnemosyne-pointer-merge-job.ts` runs nightly:
  selects pointer rows where `len(fact_ids) < 3` and merges them
  into a sibling row with the same lemmatized topic.

**Migration filename.** `0049_mnemosyne_pointer.sql`.

**Test.**
`packages/mnemosyne/tests/integration/pointer-recall.spec.ts` —
new file. Assertions:

- Pointer hit returns relevant facts faster than equivalent L2 probe
  (timing assertion is best-effort; primary assertion is
  correctness — pointer-returned ids are a superset of facts ever
  matched by L2 for the same topic).
- Pointer miss → L2 fall-through, recall still correct.
- Flag off → pointer table untouched, recall identical to v1.6.
- `upsertPointerForFact` is idempotent on repeated commits.

**Effort.** L (5 days). **Dependencies.** A.4 (provenance), A.5
(edge recovery) ideally land first because the pointer fan-out
benefits from the cleaner edge graph.

### C.2 — Hebbian + Ebbinghaus dynamics with spacing effect

**Goal.** Replace static `confidence`-driven recall ranking with
learned per-fact `strength` and `stability`. mempalace idea #2.

**Files.**

- `packages/db/migrations/0050_mnemosyne_fact_dynamics.sql` — new.
- `packages/db/src/schema/mnemosyne.ts` — add columns.
- `packages/mnemosyne/src/primitives/fact.ts` — `markRecalled`
  becomes the Hebbian update site; new helper `decayScore(fact)`.
- `packages/mnemosyne/src/recall/search.ts` — score multiplier
  switches from ADR-019's static half-life to
  `strength * exp(-days_since_access / stability)`.
- `apps/web/worker/mnemosyne-dynamics-backfill-job.ts` — one-shot
  backfill job runnable per workspace.

**Schema changes.**

```sql
-- 0050_mnemosyne_fact_dynamics.sql
--
-- Hebbian + Ebbinghaus dynamics. Three columns per fact:
--   strength       — Hebbian potentiation, +0.05 per access, capped
--   stability      — grows only when accesses are ≥1h apart
--                    (Cepeda spacing effect)
--   last_access_at — recency for the exponential decay
--
-- Recall ranking multiplier becomes:
--   strength * exp(-days_since_access / stability)
-- with a floor of 0.05 so very stale but historically strong facts
-- can still surface on direct topic match.

ALTER TABLE mnemo_fact
  ADD COLUMN strength       real NOT NULL DEFAULT 0.5
    CHECK (strength BETWEEN 0 AND 1),
  ADD COLUMN stability      real NOT NULL DEFAULT 1.0
    CHECK (stability > 0),
  ADD COLUMN last_access_at timestamptz NOT NULL DEFAULT now();

-- Partial index over high-strength facts for the rerank planner.
CREATE INDEX idx_mnemo_fact_high_strength
  ON mnemo_fact (workspace_id, strength DESC)
  WHERE strength >= 0.7;

-- Index for the decay scoreboard (top stale + still-strong facts
-- that the daily refresh cron may want to nudge).
CREATE INDEX idx_mnemo_fact_last_access
  ON mnemo_fact (workspace_id, last_access_at);
```

**Code changes.**

- `primitives/fact.ts:markRecalled` becomes the Hebbian update:

  ```ts
  export async function markRecalled(
    workspaceId: string,
    factIds: string[],
    tx: Tx
  ): Promise<void> {
    // Hebbian +0.05 (capped at 1.0); stability grows by 0.5 ONLY
    // when (now - last_access_at) > 1h (Cepeda spacing).
    await tx.execute(sql`
      UPDATE mnemo_fact SET
        strength       = LEAST(1.0, strength + 0.05),
        stability      = CASE
          WHEN now() - last_access_at > interval '1 hour'
          THEN stability + 0.5
          ELSE stability
        END,
        last_access_at = now(),
        recall_count   = recall_count + 1,
        updated_at     = now()
      WHERE workspace_id = ${workspaceId}
        AND id = ANY(${factIds})
    `);
  }
  ```

- `recall/search.ts` rerank stage: when the flag is on, multiply
  the per-fact score by
  `strength * exp(-days_since_access / stability)` (clamped at
  0.05). Behind `mnemo.v2.dynamics_enabled`; off → ADR-019 path.
- `apps/web/worker/mnemosyne-dynamics-backfill-job.ts`:

  ```ts
  // Batched UPDATE of strength := current_confidence,
  // last_access_at := updated_at, stability := 1.0. Runs in
  // pages of 1000 rows with a 30s sleep between batches so
  // pg-boss doesn't saturate.
  ```

**Migration filename.** `0050_mnemosyne_fact_dynamics.sql`.

**Test.**
`packages/mnemosyne/tests/integration/fact-dynamics.spec.ts` —
new file. Assertions:

- `markRecalled` bumps `strength` by 0.05, caps at 1.0.
- Two recalls within the same hour: `stability` unchanged.
- Two recalls >1h apart: `stability` grows by 0.5.
- Recall score for fact A (recently accessed, high strength)
  beats fact B (older, same FTS+vector score, default strength).
- With the flag off, recall ranking is identical to v1.6 (golden
  test against existing fixtures in `recall-search.spec.ts`).

**Effort.** L (5 days). **Dependencies.** C.1 lands first
chronologically only because it provides the dark-launch
telemetry shape we need for the strength-vs-static A/B; otherwise
both can be developed in parallel.

---

## Rollout strategy

### Merge order

1. **Phase A (week 1).** Eight S-tier tasks. Land sequentially or in
   parallel as PR capacity allows. All ship without feature flags;
   each is additive and reversible by a single down-migration.
2. **Phase B (weeks 2–3).** B.1 (sweeper), B.2 (unresolved
   mentions), B.3 (co-location boost). B.1 and B.2 ship behind
   per-workspace flags (`mnemo.v2.sweeper_enabled` is wired through
   `agent-runtime.ts`; B.2 is always-on once merged because
   "silent beats wrong" is a correctness improvement). B.3 is
   always-on once merged.
3. **Phase C (weeks 4–5).** Both tasks ship dark-launched:
   - **Week 4.** Merge migrations `0049` and `0050`. Columns and
     table exist; recall path is unchanged because both flags
     default off.
   - **Week 4 + 1d.** Run the dynamics backfill job for the
     dogfood workspace (`acme-inc`). Observe pg-boss queue depth
     and recall MRR delta in the Inspector UI for 48h.
   - **Week 4 + 3d.** Flip `mnemo.v2.dynamics_enabled = true` on
     `acme-inc`. Telemetry: recall MRR over 100 canned queries,
     compare to pre-flip baseline.
   - **Week 5.** If dynamics MRR holds, flip
     `mnemo.v2.pointer_index_enabled` on `acme-inc`. Run the
     pointer-merge cron on the second night. Telemetry: pointer
     hit-rate, fall-through-to-L2 rate, latency p50/p95.
   - **Week 5 + 4d.** If both flags are healthy on dogfood, enable
     by default for new workspaces. Existing workspaces remain
     opt-in for a 30-day soak.

### Feature flag plumbing

All three flags read from a new `workspace_setting` row
(`packages/db/src/schema/core.ts`, already exists, no migration
needed). Sample shape:

```jsonb
{
  "mnemo": {
    "v2": {
      "dynamics_enabled": true,
      "pointer_index_enabled": true,
      "sweeper_enabled": false
    }
  }
}
```

`isFlagOn(workspaceId, path, tx)` is a new helper in
`packages/mnemosyne/src/index.ts` that reads the setting row inside
the existing `withMnemoTx` transaction so the GUC is honored.

### Data backfills

**Dynamics columns (C.2).** Idempotent batched UPDATE:

```sql
WITH batch AS (
  SELECT id FROM mnemo_fact
  WHERE workspace_id = $1
    AND last_access_at = created_at      -- never been recalled
    AND strength = 0.5                   -- default, never been touched
  ORDER BY created_at
  LIMIT 1000
)
UPDATE mnemo_fact f SET
  strength       = COALESCE(f.confidence, 0.5),
  last_access_at = f.updated_at,
  stability      = 1.0
FROM batch b
WHERE f.id = b.id;
```

Runs in `apps/web/worker/mnemosyne-dynamics-backfill-job.ts`. Loop
exits when `affected_rows == 0`. 30s sleep between iterations. For
the largest dogfood workspace (~1.2M facts) the backfill completes
in ~10h. Resumable: a re-run picks up where it left off via the
sentinel predicate `last_access_at = created_at AND strength = 0.5`.

**Pointer table (C.1).** No backfill required at flag-flip time.
The table populates incrementally as commits arrive. Optional
**warm-up** cron (`mnemo-pointer-warmup-job`) runs once per
workspace to seed pointer rows from the top 500 most-recalled facts
in the last 30 days — keyed by `subject` as the topic.

**Provenance (A.4).** Single SQL UPDATE in the migration itself —
every existing row was LLM-derived, so the backfill is a one-shot
`UPDATE mnemo_relation SET provenance = 'llm'` inside the
migration before the DEFAULT is dropped.

### Rollback

- Phase A: each migration ships a `.down.sql`. Code paths revert by
  reverting the merge commit.
- Phase B: same, plus the per-workspace flag flips off the sweeper
  cron immediately.
- Phase C: feature flags off → recall returns to v1.6 behaviour.
  Migrations `0049` and `0050` can be left in place (zero compute
  cost when unread) or dropped via their `.down.sql` files.

### Observability

The Inspector UI (`apps/web/app/api/mnemo/*`) gets three new
read-only endpoints:

- `GET /api/mnemo/v2/pointer-stats` — hit-rate, fall-through rate,
  top-50 pointer rows by `strength * log(1 + access_count)`.
- `GET /api/mnemo/v2/dynamics-distribution` — histogram of
  `strength`, `stability`, `days_since_access` across all facts.
- `GET /api/mnemo/v2/sweeper-status` — last cursor per
  conversation, recovered-facts tally per 24h window.

All three honor the same workspace scope + RLS contract as the rest
of `/api/mnemo/*`.

### Protocol bump

Memory Protocol bumps v1.2 → v1.3 in Phase A.6 (only the
`stale: boolean` field on the agent injection contract). No tool
surface changes. Agents written against v1.2 continue to function;
the new field is optional in their schema.

`protocol_version` on `mnemo_fact` (migration `0041`) gets a new
allowed value `v1.3.0`. Add the migration in Phase A or as a
trailer to Phase C — order independent.

---

## Open questions

1. **Pointer topic derivation.** Currently the plan derives topic
   from `mnemo_fact.subject`. Alternative: derive from the
   linked-entity canonical name. Defer to first-mile telemetry —
   land both options behind a sub-flag if uncertain.
2. **Stability growth constant.** mempalace uses +0.5 per
   spacing-effect-positive access. Our facts are denser than theirs
   (multi-turn conversations vs. discrete notes). The constant may
   need re-tuning after the dogfood window; expose it as a
   per-workspace setting under `mnemo.v2.stability_step` if needed.
3. **Provenance + diversity-cap interaction.** A heuristic-edge boost
   to a fact may now be suppressed by the per-entity cap from A.8.
   Acceptable; document in the rerank pipeline doc-comment.
4. **Backfill cost on the largest workspaces.** A 1.2M-row UPDATE
   pass at 1000/30s is ~10h. If that's too slow once we onboard a
   10M-fact workspace, raise the batch size to 5000 and drop the
   sleep — Postgres autovacuum keeps up because the rows are touched
   only once and the predicates use the partial index.

---

## Cross-references

- ADR-003 (Postgres-only) — substrate constraint.
- ADR-006 (multi-tenancy isolation) — new tables comply.
- ADR-010 (FORCE RLS Pattern A) — every new table calls
  `apply_pattern_a()`.
- ADR-013 (GUC tenancy) — `withMnemoTx` envelope used unchanged.
- ADR-018 (HNSW choice) — unchanged; pointer index is a _bias_
  before HNSW, not a replacement.
- ADR-019 (exponential decay) — superseded for recall ranking when
  `mnemo.v2.dynamics_enabled` is on; retained as the fallback
  path.
- ADR-020 (Mnemosyne multi-tenant memory) — v1.0/v1.5/v1.6
  amendments. This plan extends from the v1.6 surface.
- ADR-021 (Mnemosyne v2) — companion to this plan.
- v1.6 audit: `docs/specs/audits/2026-05-26-mnemosyne-v1.6-final-audit.md`.
- Source materials: external repos `mempalace/mempalace` and
  `colbymchenry/codegraph`.
