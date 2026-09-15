-- packages/db/migrations/0026_mnemosyne_bitemporal_gist.sql
--
-- Spec §2.1 — Bitemporal GIST indexes on (valid_from, valid_to) ranges
-- for mnemo_fact / mnemo_decision / mnemo_relation. The columns themselves
-- already exist (migrations 0017, 0018, 0020); this migration only adds
-- the supporting GIST indexes so range-overlap queries against the
-- tstzrange of validity can use an index instead of a sequential scan.
--
-- Why tstzrange(valid_from, valid_to): "currently valid" rows have
-- valid_to IS NULL, which tstzrange treats as +infinity. That matches
-- the dedup partial indexes (e.g. uniq_mnemo_fact_dedup on
-- "WHERE status='active' AND valid_to IS NULL") and the spec's
-- bitemporal semantics: a fact is in effect from valid_from until either
-- it is superseded (valid_to set to the superseding fact's valid_from)
-- or forever (valid_to stays NULL).
--
-- IF NOT EXISTS so re-running the migration is safe on already-indexed
-- environments (matches the style of 0025).

CREATE INDEX IF NOT EXISTS idx_mnemo_fact_valid
  ON mnemo_fact USING gist (tstzrange(valid_from, valid_to));

CREATE INDEX IF NOT EXISTS idx_mnemo_decision_valid
  ON mnemo_decision USING gist (tstzrange(valid_from, valid_to));

CREATE INDEX IF NOT EXISTS idx_mnemo_relation_valid
  ON mnemo_relation USING gist (tstzrange(valid_from, valid_to));
