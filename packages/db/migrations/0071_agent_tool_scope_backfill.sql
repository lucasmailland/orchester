-- packages/db/migrations/0071_agent_tool_scope_backfill.sql
--
-- EXEC-005: run_integration and flow_call now reach only the integrations and
-- flows listed in agent.config.allowedIntegrationIds / allowedFlowIds, and a
-- missing list means none. Without this backfill every agent that uses those
-- tools would lose them on deploy. Each such agent gets what it called
-- successfully in the last 90 days, according to the tool call log (0064):
--
-- - Integrations: tool_call.integration_type holds whatever the model passed
--   as integrationId, a row id or a connector type ("odoo"). A type maps to
--   the workspace's integration rows of that type.
-- - Flows: input->>'flowId', kept only if the flow still exists in the
--   workspace.
--
-- Agents without the tool are not touched, and neither is a key that is
-- already set, so re-running this is a no-op.
UPDATE "agent" a
SET "config" = COALESCE(a."config", '{}'::jsonb) || jsonb_build_object(
  'allowedIntegrationIds',
  COALESCE(
    (
      SELECT jsonb_agg(wi."id" ORDER BY wi."id")
      FROM "workspace_integration" wi
      WHERE wi."workspace_id" = a."workspace_id"
        AND EXISTS (
          SELECT 1
          FROM "tool_call" tc
          WHERE tc."workspace_id" = a."workspace_id"
            AND tc."agent_id" = a."id"
            AND tc."tool" = 'run_integration'
            AND tc."outcome" = 'ok'
            AND tc."created_at" > now() - interval '90 days'
            AND tc."integration_type" IN (wi."id", wi."type")
        )
    ),
    '[]'::jsonb
  )
)
WHERE jsonb_typeof(a."tools") = 'array'
  AND a."tools" @> '["run_integration"]'::jsonb
  AND NOT jsonb_exists(COALESCE(a."config", '{}'::jsonb), 'allowedIntegrationIds');

UPDATE "agent" a
SET "config" = COALESCE(a."config", '{}'::jsonb) || jsonb_build_object(
  'allowedFlowIds',
  COALESCE(
    (
      SELECT jsonb_agg(f."id" ORDER BY f."id")
      FROM "flow" f
      WHERE f."workspace_id" = a."workspace_id"
        AND EXISTS (
          SELECT 1
          FROM "tool_call" tc
          WHERE tc."workspace_id" = a."workspace_id"
            AND tc."agent_id" = a."id"
            AND tc."tool" = 'flow_call'
            AND tc."outcome" = 'ok'
            AND tc."created_at" > now() - interval '90 days'
            AND tc."input"->>'flowId' = f."id"
        )
    ),
    '[]'::jsonb
  )
)
WHERE jsonb_typeof(a."tools") = 'array'
  AND a."tools" @> '["flow_call"]'::jsonb
  AND NOT jsonb_exists(COALESCE(a."config", '{}'::jsonb), 'allowedFlowIds');
