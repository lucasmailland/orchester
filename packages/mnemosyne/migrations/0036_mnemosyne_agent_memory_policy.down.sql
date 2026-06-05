-- Reverse migration 0036_mnemosyne_agent_memory_policy.sql

ALTER TABLE agent
  DROP COLUMN IF EXISTS memory_policy;
