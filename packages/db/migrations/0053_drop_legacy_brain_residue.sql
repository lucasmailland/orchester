-- packages/db/migrations/0053_drop_legacy_brain_residue.sql
--
-- Phase 3 — drop the last legacy host-side memory tables.
--
-- Background
-- ----------
-- Migrations 0016 (brain_core) and 0025 (brain_extraction_skip_state)
-- created `brain_fact` and `brain_extraction_job` when orchester owned
-- the memory subsystem in-process. The Phase 3 cut-over (2026-06-05)
-- moved every memory operation to the @mnemosyne/server HTTP service,
-- which has its own Postgres + schema. The drizzle table definitions
-- and code paths were deleted in the same commit, but the physical
-- tables in orchester's database stayed behind as orphaned data.
--
-- This migration finishes the job: it drops the two residual tables
-- so the host DB no longer carries shadow memory state. The old
-- CREATE TABLE migrations stay in tree (migrations are immutable
-- history); this final drop is what brings a fresh `pnpm db:migrate`
-- to the same shape as a long-running deployment after Phase 3.
--
-- Affected tables (orchester DB only):
--   - brain_fact                 — 102 rows on dev (last write 2026-05-30)
--   - brain_extraction_job       — 8 rows on dev (last write 2026-05-30)
--
-- Memory data is preserved upstream in the @mnemosyne/server DB; the
-- migration that copied it across happened in Phase B.1 well before
-- this drop. No restore path is wired because the orphans have been
-- read-only since the cut-over — anything written through the SDK
-- since then never touched these tables.
--
-- The mnemo_* tables that used to live here were already dropped in
-- Phase B.5 before this migration ships, so they're listed in the
-- `IF EXISTS` block below purely as a no-op safety net for any
-- environment where the prior drop hadn't run yet.

-- No explicit BEGIN/COMMIT — the migrator (`sql.unsafe()` in
-- tests/fixtures/db.ts and the same primitive in prod tooling) wraps
-- each file in its own transaction. An inner BEGIN trips postgres-js's
-- UNSAFE_TRANSACTION guard.

-- brain_* tables — created by 0016, 0024, 0025.
DROP TABLE IF EXISTS brain_fact CASCADE;
DROP TABLE IF EXISTS brain_extraction_job CASCADE;

-- mnemo_* tables — should already be gone from Phase B.5. Listed
-- defensively so a fresh `pnpm db:migrate` against an environment
-- that never saw the Phase B.5 manual drop arrives at the same
-- final shape.
DROP TABLE IF EXISTS mnemo_fact CASCADE;
DROP TABLE IF EXISTS mnemo_episode CASCADE;
DROP TABLE IF EXISTS mnemo_entity CASCADE;
DROP TABLE IF EXISTS mnemo_relation CASCADE;
DROP TABLE IF EXISTS mnemo_citation CASCADE;
DROP TABLE IF EXISTS mnemo_decision CASCADE;
DROP TABLE IF EXISTS mnemo_query_cache CASCADE;
DROP TABLE IF EXISTS mnemo_review_queue CASCADE;
DROP TABLE IF EXISTS mnemo_summary CASCADE;
DROP TABLE IF EXISTS mnemo_archive CASCADE;
DROP TABLE IF EXISTS mnemo_health CASCADE;
DROP TABLE IF EXISTS mnemo_provider_health CASCADE;
DROP TABLE IF EXISTS mnemo_attribution CASCADE;
DROP TABLE IF EXISTS mnemo_agent_memory_policy CASCADE;
DROP TABLE IF EXISTS mnemo_actor_id CASCADE;
DROP TABLE IF EXISTS mnemo_actor_isolation_policy CASCADE;
DROP TABLE IF EXISTS mnemo_relation_provenance CASCADE;
DROP TABLE IF EXISTS mnemo_unresolved_mention CASCADE;
DROP TABLE IF EXISTS mnemo_org_fact_view CASCADE;
DROP TABLE IF EXISTS mnemo_cron_schedule CASCADE;
