-- packages/db/migrations/0045_mnemo_fact_memory_strength.sql
--
-- Mnemosyne v1.1 #10 — Hebbian potentiation + Ebbinghaus decay +
-- Cepeda spacing.
--
-- Adds three columns to mnemo_fact that power the cognitive memory
-- strength model:
--
--   memory_strength      — current trace strength in [0.05, 5.0].
--                          Initialized to 1.0 (neutral). Potentiated
--                          by POTENTIATION_INCREMENT (0.05) on each
--                          qualifying recall (Cepeda ≥ 1 h spacing);
--                          decays exponentially between recalls via
--                          the Ebbinghaus forgetting curve.
--
--   memory_stability     — time constant of the forgetting curve in
--                          days. Higher = slower decay. Initialized to
--                          1.0. Incremented by STABILITY_INCREMENT (0.1)
--                          on each potentiating recall so frequently-
--                          recalled facts become progressively harder
--                          to forget (SRS / spaced-repetition effect).
--
--   last_strength_update — timestamp of the last decay + potentiation
--                          application. NULL = fact has never been
--                          through markRecalled (strength is at the DB
--                          default). Used as the reference point for
--                          the exponential decay formula:
--                            decay_factor = exp(-days_elapsed / stability)
--                            new_strength = max(0.05, old × decay_factor)
--                                         [+ 0.05 if spacing ≥ 1 h]
--
-- All columns are NOT NULL (or nullable with a safe default) so the
-- migration is backward-compatible — existing rows behave as if they
-- have never been recalled under the new model: strength=1.0,
-- stability=1.0, no strength-update timestamp.
--
-- §0.1: migration-safe — additive only, no backfill required.

ALTER TABLE mnemo_fact
  ADD COLUMN IF NOT EXISTS memory_strength    float NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS memory_stability   float NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS last_strength_update timestamptz DEFAULT NULL;

-- Partial index on active facts to support future "find weak memories"
-- sweeper queries (e.g. the review-sweep cron surfacing low-strength
-- facts for human triage). Partial on status='active' keeps the index
-- small and hot; forgotten/merged facts are not candidates for sweeps.
CREATE INDEX IF NOT EXISTS idx_mnemo_fact_memory_strength
  ON mnemo_fact (workspace_id, memory_strength)
  WHERE status = 'active';
