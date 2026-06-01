-- Reverse migration 0050_mnemo_org_fact_view.sql
DROP POLICY IF EXISTS org_user_select ON mnemo_org_fact_view;
DROP INDEX IF EXISTS idx_mnemo_org_fact_view_subject_kind;
DROP INDEX IF EXISTS idx_mnemo_org_fact_view_org;
DROP TABLE IF EXISTS mnemo_org_fact_view;
-- Leave `app_org_user` role intact — other migrations may reference it.
