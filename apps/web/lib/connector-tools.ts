/**
 * The typed connector tools (`odoo_get_task`, `gitlab_read_file`, …) and the
 * integration action each one runs. Its own module, free of server imports, so
 * the tool registry (`lib/tools.ts`) and the tool call log
 * (`lib/activity/tool-calls.ts`) read the same map without importing each other.
 */

/**
 * Tools tipadas que delegan en una acción de un connector. El modelo ve el
 * schema de la tool; la credencial y la validación viven server-side, igual
 * que en `run_integration`.
 */
export const CONNECTOR_TOOLS: Record<
  string,
  {
    integrationId: string;
    action: string;
    /** Filled in when the model leaves them out. */
    defaults?: Record<string, unknown>;
    /** Always win over the model's input: what makes a narrower tool narrower. */
    fixed?: Record<string, unknown>;
    /** The only input keys passed on; anything else the model sends is dropped. */
    allowedKeys?: readonly string[];
  }
> = {
  odoo_create_ticket: { integrationId: "odoo", action: "create_ticket" },
  odoo_post_note: { integrationId: "odoo", action: "post_note" },
  odoo_post_task_note: {
    integrationId: "odoo",
    action: "post_note",
    // A task note and nothing else: no ticket, no raw HTML body.
    fixed: { model: "project.task" },
    allowedKeys: ["id", "body_markdown", "marker"],
  },
  odoo_search_tickets: { integrationId: "odoo", action: "search_tickets" },
  odoo_get_ticket: { integrationId: "odoo", action: "get_ticket" },
  odoo_get_task_attachments: { integrationId: "odoo", action: "get_task_attachments" },
  odoo_get_attachment_table: { integrationId: "odoo", action: "get_attachment_table" },
  odoo_get_partner: { integrationId: "odoo", action: "get_partner" },
  odoo_list_stages: { integrationId: "odoo", action: "list_stages" },
  odoo_get_task: { integrationId: "odoo", action: "get_task" },
  odoo_search_tasks: { integrationId: "odoo", action: "search_tasks" },
  odoo_get_task_notes: {
    integrationId: "odoo",
    action: "get_task_notes",
    // Tracking messages drown the notes an agent needs; flows keep the raw default.
    defaults: { exclude_tracking: true },
  },
  odoo_get_case: { integrationId: "odoo", action: "get_case" },
  newrelic_get_errors: { integrationId: "newrelic", action: "get_errors" },
  newrelic_get_logs_for_trace: { integrationId: "newrelic", action: "get_logs_for_trace" },
  newrelic_get_browser_errors: { integrationId: "newrelic", action: "get_browser_errors" },
  newrelic_search_logs: { integrationId: "newrelic", action: "search_logs" },
  newrelic_get_deployments: { integrationId: "newrelic", action: "get_deployments" },
  gitlab_search_code: { integrationId: "gitlab", action: "search_code" },
  gitlab_read_file: { integrationId: "gitlab", action: "read_file" },
  gitlab_list_commits: { integrationId: "gitlab", action: "list_commits" },
  gitlab_list_merge_requests: { integrationId: "gitlab", action: "list_merge_requests" },
  gitlab_get_diff: { integrationId: "gitlab", action: "get_diff" },
};
