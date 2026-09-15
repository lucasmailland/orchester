-- packages/db/migrations/0002c_audit_log_data_migration.sql
--
-- Migrate legacy rows into the new audit_log schema with synthetic chain.
-- Pre-chain entries are marked with `legacy.` action prefix and zero
-- payload/chain hashes; they exist for historical visibility but are
-- excluded from chain verification (verify cron filters action LIKE
-- 'legacy.%' or treats them as pre-genesis).
--
-- `seq` is monotonic per workspace starting at 1, ordered by
-- (created_at, id) so two entries with identical timestamp get a stable
-- tiebreak.

WITH numbered AS (
  SELECT
    *,
    row_number() OVER (PARTITION BY workspace_id ORDER BY created_at, id) AS rn
  FROM audit_log_legacy
)
INSERT INTO audit_log (
  id, workspace_id, seq, prev_hash, payload_hash, chain_hash,
  action, actor_user_id, actor_kind, actor_ip, actor_user_agent,
  target_type, target_id, meta, created_at
)
SELECT
  id,
  workspace_id,
  rn::bigint,
  NULL,                              -- pre-chain: no prev
  repeat('0', 64),                   -- placeholder payload hash
  repeat('0', 64),                   -- placeholder chain hash
  'legacy.' || COALESCE(action, 'unknown'),
  user_id,
  'user',
  CASE
    WHEN ip ~ '^[0-9.]+$' OR ip ~ '^[a-fA-F0-9:]+$' THEN ip::inet
    ELSE NULL
  END,
  user_agent,
  COALESCE(resource, 'unknown'),
  COALESCE(resource_id, ''),
  jsonb_build_object('before', before, 'after', after),
  created_at::timestamptz
FROM numbered;
