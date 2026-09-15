-- Reverse migration 0040_mnemosyne_actor_isolation_policy.sql

DROP POLICY IF EXISTS mnemo_fact_actor_isolation_select ON mnemo_fact;
