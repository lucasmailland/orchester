-- Reverse migration 0018_mnemosyne_decision.sql
DROP TRIGGER IF EXISTS mnemo_decision_updated_at ON mnemo_decision;
DROP FUNCTION IF EXISTS mnemo_decision_set_updated_at();
DROP TABLE IF EXISTS mnemo_decision CASCADE;
