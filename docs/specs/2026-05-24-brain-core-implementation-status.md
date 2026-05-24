# Brain Core (Sub-spec 2) — Implementation Status

**Tag:** `brain-core-v1-alpha`
**Branch:** `sub-spec-2/brain-core` → merged to `main`
**Depends on:** `tenant-hardening-v1.3`

This document tracks what shipped in v1-alpha vs what's deferred to
v1.0 GA (Phases BD compaction/decay + polish).

## Shipped in v1-alpha

### Schema + RLS

- Migration `0016_brain_core.sql`:
  - `brain_fact` table with `embedding vector(1536)`, HNSW index, partial-unique dedup index
  - `brain_extraction_job` table for observability
  - Pattern A RLS policies on both, FORCED from day 1
  - `updated_at` trigger on `brain_fact`
- Drizzle schema `packages/db/src/schema/brain.ts` mirrors SQL exactly
- `BrainFact`, `NewBrainFact`, `BrainExtractionJob`, `NewBrainExtractionJob` types exported

### Lib

- `lib/brain/types.ts` — `BrainFact`, `FactKind`, `FactScope`, `FactStatus`, `RecallHit`, `FactExtractionInput`
- `lib/brain/store.ts` — CRUD: `createFact`, `forgetFact`, `listFacts`, `getFact`, `updateFact`, `markRecalled`, `withBrainTx`
- `lib/brain/embed.ts` — workspace-keyed LRU embedding cache wrapping `lib/embeddings`
- `lib/brain/recall.ts` — `searchBrain` with hybrid scoring (semantic 0.5 + recency 0.15 + frequency 0.1 + relevance 0.2 + pin 0.05) + 60s LRU cache + `invalidateRecallCache`
- `lib/brain/extract.ts` — LLM-driven fact extraction with zod-validated output
- `lib/brain/extract-job.ts` — pg-boss handler + `enqueueBrainExtract` helper
- `lib/brain/index.ts` — barrel export

### Worker integration

- `JOB_BRAIN_EXTRACT` constant in `lib/queue.ts`
- `runBrainExtractJob` registered in `apps/web/worker/index.ts`
- `enqueueBrainExtract` wired in `apps/web/lib/channels/router.ts handleInbound`:
  fires after the assistant turn commits, with singleton-key per conversation
  to collapse concurrent triggers

### Agent runtime

- Tool `brain_recall` added to `lib/tools.ts`:
  - Description: "Search the workspace's brain for relevant facts about the conversation participants."
  - Inputs: `query` (required), `topK` (default 5, capped at 20)
  - Returns: ranked hits with `{kind, subject, statement, confidence, score}`
- Tool handler calls `searchBrain` with `agentId` and `scope=conversation` from `ToolContext`

### API surface

- `GET  /api/workspaces/[slug]/brain/facts` — paginated list with filters (agent, scope, scopeRef, status)
- `POST /api/workspaces/[slug]/brain/facts` — manually create a fact (admin)
- `GET    /api/workspaces/[slug]/brain/facts/[id]` — single fact
- `PATCH  /api/workspaces/[slug]/brain/facts/[id]` — update fact (pin, edit)
- `DELETE /api/workspaces/[slug]/brain/facts/[id]` — soft-delete (status='forgotten')
- `POST /api/workspaces/[slug]/brain/search` — hybrid recall query

All routes: `requireAuth` → `resolveBySlug` → `isAccessible` → `assertCan(brain.read|brain.write)` → `withBrainTx(SET LOCAL workspace_id)` → query → `appendAudit` for mutations.

### RBAC

- Two new Actions: `brain.read`, `brain.write`
- `brain.read` granted to viewer/editor/admin/owner
- `brain.write` granted to admin/owner only

### GDPR export

- `lib/gdpr/exporters/brain.ts` — dumps active `brain_fact` rows (embedding stripped)
- Added to export-job STEPS with weight 10, repartitioned other weights

### UI

- `components/brain/BrainPanel.tsx` — list + search + pin + forget controls (basic)

## Deferred (Phase BD + polish — track here)

### Phase BD compaction + decay

- `lib/brain/compaction.ts` + `compact-job.ts` — daily per-workspace dedup pass
  (merge facts with same subject + semantic similarity > 0.95, fold older ones
  into newer with `merged_into_id`)
- `lib/brain/decay.ts` + `decay-job.ts` — daily relevance decay sweep
  (exp decay with half-life 30d, pin overrides)
- Register both in worker + `boss.schedule` with `retryLimit:0`

### Phase BC continuation

- Passive injection in `router.ts buildConversationContext`:
  currently agents must call `brain_recall` tool explicitly; the design
  proposes also auto-injecting top-3 hits into the system prompt block.
  Not blocking — `brain_recall` tool already works.

### Polish

- `BrainStats.tsx` — workspace-level stats card (count by kind, top subjects, recall hit rate)
- `FactCard.tsx` extracted from BrainPanel inline
- Settings tab integration — add "Brain" tab to `apps/web/app/[locale]/[workspaceSlug]/(shell)/settings/page.tsx`
- Agent Studio MemoryPanel — sub-tab "Brain" showing agent-scoped facts
- i18n keys for `brain.*` namespace (en/es/pt-BR) — currently using literal strings
- Backfill job `JOB_BRAIN_BACKFILL` for existing conversations — gated by feature flag
- POST `/api/workspaces/[slug]/brain/forget` — fuzzy-match forget endpoint
- GET `/api/workspaces/[slug]/brain/stats` — counts + hit rate

### Hardening

- `recall.ts` invalidate cache via cluster-cache (currently in-process only)
- Embedding cost metering: `embed()` should call `recordAiUsage`
- Native dims per model (drop zero-padding) — coordinate with `lib/embeddings.ts`
- Tier-based fact count limits (enforced in extraction worker)
- Tests:
  - `tests/integration/brain/extraction.spec.ts`
  - `tests/integration/brain/recall.spec.ts`
  - `tests/isolation/brain-facts.spec.ts`
  - Unit tests on decay formula, scoring, cache

### ADRs to write

- ADR-14: Fact format (structured hybrid)
- ADR-15: Extraction model (cheap per-batch)
- ADR-16: Recall hybrid scoring
- ADR-17: Single table + embedding column
- ADR-18: HNSW over IVFFlat
- ADR-19: Exponential decay with pin override

## Verification (manual, against dev DB)

- Migration applied: `psql -c "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('brain_fact','brain_extraction_job')"` → both `t/t`
- Typecheck clean: `pnpm exec tsc -p apps/web/tsconfig.json --noEmit` → no errors
- Worker boots: launches handler for `JOB_BRAIN_EXTRACT`
- Extraction end-to-end: requires running dev server + worker + at least one
  workspace with an `ai_provider` row + a conversation; deferred to manual
  smoke when the user wakes up

## Commits since branch creation

- `62fbc53` docs(spec): brain core design
- `16666d5` feat(brain): phase BA foundation
- `d159bec` feat(brain): phase BB extraction worker
- `52778fd` feat(brain): API routes facts/search + brain.read/write RBAC
- (worker + tool wiring)
- (UI + GDPR exporter)

## Path to brain-core-v1 GA

1. Phase BD compaction + decay (estimated 2-3 days)
2. Passive injection in router buildConversationContext (1 day)
3. i18n keys + polish UI (1 day)
4. Integration test suite (2 days)
5. Isolation suite extension (0.5 day)
6. ADRs 14-19 (1 day)
7. Tag `brain-core-v1`

Total: ~1.5 weeks to GA.
