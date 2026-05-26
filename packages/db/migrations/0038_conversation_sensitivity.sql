-- packages/db/migrations/0038_conversation_sensitivity.sql
--
-- Mnemosyne v1.5 "The Wire-Up" — per-conversation memory sensitivity gate.
--
-- Adds a single boolean to `conversation`: when set true, the brain
-- extraction pipeline skips this conversation entirely (no LLM call,
-- no facts written, no episode synthesis). The Inspector / operator
-- toggles this on for legal-hold, HR-sensitive, or otherwise out-of-
-- bounds conversations.
--
-- Semantics:
--   • FALSE (default) — current behaviour: extraction runs as normal.
--   • TRUE            — extract-job short-circuits with
--                       `state='skipped_sensitivity'` BEFORE the LLM
--                       call. Already-extracted facts from earlier
--                       turns stay put (this is a forward gate, not a
--                       retroactive forget).
--
-- No index on this column: it's a per-row gate read once per extract
-- job (already keyed by conversation_id PK), never a query filter.

ALTER TABLE conversation
  ADD COLUMN IF NOT EXISTS memory_learning_paused boolean NOT NULL DEFAULT false;
