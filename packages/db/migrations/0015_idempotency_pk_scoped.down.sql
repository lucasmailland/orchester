-- packages/db/migrations/0015_idempotency_pk_scoped.down.sql

ALTER TABLE idempotency_key DROP CONSTRAINT idempotency_key_pkey;

ALTER TABLE idempotency_key
  ADD CONSTRAINT idempotency_key_pkey
  PRIMARY KEY (user_id, endpoint, key);

ALTER TABLE idempotency_key
  ALTER COLUMN workspace_id DROP NOT NULL;
