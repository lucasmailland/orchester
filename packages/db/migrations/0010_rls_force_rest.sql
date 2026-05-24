-- packages/db/migrations/0010_rls_force_rest.sql
--
-- Phase C.3 — FORCE ROW LEVEL SECURITY on the remaining tenant tables.
-- 0009 covered the highest-risk surface (audit/memory/conversations);
-- this migration completes the enforcement on everything else that has a
-- workspace_id column (Pattern A) plus idempotency_key (Pattern A with
-- nullable workspace_id).
--
-- Explicitly NOT FORCED here (kept loose by design):
--   * workspace            — Pattern C, must be readable by members
--                            across their workspace_id contexts.
--   * workspace_member     — Pattern C, the policy is keyed on user_id.
--   * user / session / account / verification / two_factor
--     (better-auth tables don't carry workspace_id; not in scope).
--   * message              — Pattern B (JOIN through conversation). Once
--                            the join policy is validated under FORCE,
--                            can be added in a follow-up. Leaving it
--                            unforced keeps the message hot path safe
--                            for the canary period.

ALTER TABLE team FORCE ROW LEVEL SECURITY;
ALTER TABLE agent FORCE ROW LEVEL SECURITY;
ALTER TABLE channel FORCE ROW LEVEL SECURITY;
ALTER TABLE employee FORCE ROW LEVEL SECURITY;
ALTER TABLE flow FORCE ROW LEVEL SECURITY;
ALTER TABLE flow_run FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_doc FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_label FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_pref FORCE ROW LEVEL SECURITY;
ALTER TABLE outbound_webhook FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_key FORCE ROW LEVEL SECURITY;
