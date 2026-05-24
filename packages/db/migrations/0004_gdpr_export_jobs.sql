-- packages/db/migrations/0004_gdpr_export_jobs.sql

CREATE TYPE gdpr_export_state AS ENUM (
  'pending', 'exporting', 'uploading', 'emailing', 'completed', 'failed'
);

CREATE TABLE gdpr_export_job (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  requested_by_user_id text NOT NULL REFERENCES "user"(id),
  state gdpr_export_state NOT NULL DEFAULT 'pending',
  progress integer NOT NULL DEFAULT 0,
  format text NOT NULL DEFAULT 'json+csv',
  storage_key text,
  signed_url text,
  signed_url_expires_at timestamptz,
  bytes_total bigint,
  error text,
  retry_count integer NOT NULL DEFAULT 0,
  checkpoint jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX idx_gdpr_export_workspace ON gdpr_export_job(workspace_id, created_at DESC);
CREATE INDEX idx_gdpr_export_state ON gdpr_export_job(state)
  WHERE state IN ('pending', 'exporting', 'uploading', 'emailing');
