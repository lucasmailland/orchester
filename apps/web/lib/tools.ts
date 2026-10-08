/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — Phase 3: tools' recall path stubbed; rest still active.
import "server-only";
import { getDb, schema, type DbClient } from "@orchester/db";
import { eq, and, ne } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { assertPublicUrl } from "./net-guard";
import { fetchWithTimeout } from "./http-util";
import { logAudit } from "./audit";

/**
 * Optional `tx?: WsDb` follows the project-wide pattern (see
 * `lib/billing/quotas.ts`). When the caller is already inside a
 * workspace transaction, threading tx through `ToolContext` keeps
 * every tool's DB operation on the same connection so FORCE RLS
 * sees `app.workspace_id` SET LOCAL.
 */
type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

const HTTP_REQUEST_TIMEOUT_MS = 30_000;

export interface ToolDefinition {
  /** MCP annotations, conservatively classified for execution policies. */
  effect?: "read" | "write";
  name: string;
  description: string;
  /** JSON Schema describing the tool's input. */
  inputSchema: Record<string, unknown>;
}

export type { ImageToolOutput, ToolImagePart } from "./ai/capabilities";

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  error?: string;
}

export interface ToolContext {
  workspaceId: string;
  variables: Record<string, string>;
  /** Required for memory_* tools. Identifies the agent calling the tool. */
  agentId?: string;
  /** Optional context: lets memory tools scope to conversation. */
  conversationId?: string;
  /** Optional context: lets memory tools scope to employee/customer. */
  employeeId?: string;
  /**
   * Workspace transaction handle (R2-C). When the caller (agent
   * runtime, channels router) is inside `withWorkspaceTx`, threading
   * tx keeps every DB op done by a tool on the same connection.
   */
  tx?: WsDb;
}

const BUILTINS: Record<string, ToolDefinition> = {
  run_integration: {
    name: "run_integration",
    description:
      "Ejecuta una acción de una integración conectada del workspace (Stripe, Notion, Postgres, Resend, Slack, HTTP, etc.). Pasá el integrationId (de la lista de integraciones), el nombre de la acción y su input. Las credenciales se resuelven server-side.",
    inputSchema: {
      type: "object",
      properties: {
        integrationId: { type: "string", description: "ID de la integración configurada." },
        action: {
          type: "string",
          description: "Acción a ejecutar (ej. list_customers, query, send_email).",
        },
        input: { type: "object", description: "Parámetros de la acción." },
      },
      required: ["integrationId", "action"],
    },
  },
  current_time: {
    name: "current_time",
    description:
      "Returns the current date and time in ISO 8601 format. Optional `timezone` (IANA, e.g. 'America/Argentina/Buenos_Aires').",
    inputSchema: {
      type: "object",
      properties: {
        timezone: { type: "string" },
      },
    },
  },
  calculator: {
    name: "calculator",
    description:
      "Evaluates a basic math expression. Supports +, -, *, /, %, parentheses, integers, decimals.",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "e.g. '(15 + 3) * 2'" },
      },
      required: ["expression"],
    },
  },
  http_request: {
    name: "http_request",
    description:
      "Makes an HTTP request to a public URL. Use ONLY for safe public APIs; private IPs are blocked.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"] },
        headers: { type: "object", additionalProperties: { type: "string" } },
        body: { type: "string" },
      },
      required: ["url"],
    },
  },
  flow_call: {
    name: "flow_call",
    // It used to say "and returns its output". It does not: `enqueueFlowRun`
    // queues the run and answers `{runId, status: "pending"}`. A description is
    // the only thing the model reads when deciding what a tool gives back, so
    // that sentence did not mislead a reader — it instructed the model to
    // report results it had never seen. Say what comes back.
    description:
      "Queue another flow in this workspace. Returns only a run id: the flow has NOT run yet and its output is NOT available here. Never describe results from a flow you called with this — you have none. Tell the person it was queued, and give them the run id.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string" },
        input: { type: "object" },
      },
      required: ["flowId"],
    },
  },
  agent_handoff: {
    name: "agent_handoff",
    description:
      "Hand off the current conversation to another agent. Use this when the user's request is OUTSIDE your specialty and a teammate in your team is better suited (agents without a team can hand off to any agent in the workspace). The other agent receives the conversation history + your handoff note and continues the dialog. From the next turn forward, the other agent is the one responding.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description:
            "ID of the teammate that should take over. Use `agent_team_list` first to see who's available.",
        },
        note: {
          type: "string",
          description:
            "Short note for the receiving agent explaining the case (e.g. 'User asks about leave > 5 days, beyond my approval limit'). Becomes part of the next agent's system context.",
        },
      },
      required: ["agentId", "note"],
    },
  },
  agent_team_list: {
    name: "agent_team_list",
    description:
      "Lists the teammates in your team that you can hand off to (via `agent_handoff`). If you do not belong to a team, lists every active agent in the workspace. Returns id + name + role + short description for each.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  knowledge_search: {
    name: "knowledge_search",
    description:
      "Searches a knowledge base for relevant chunks of text using semantic search. Returns the top matches with their source document title and a relevance score (0-1).",
    inputSchema: {
      type: "object",
      properties: {
        kbId: {
          type: "string",
          description: "ID of the knowledge base to search.",
        },
        query: {
          type: "string",
          description: "Natural language query to search for.",
        },
        topK: {
          type: "number",
          description: "Number of results to return (default 5, max 20).",
        },
      },
      required: ["kbId", "query"],
    },
  },
  memory_set: {
    name: "memory_set",
    description:
      "SCRATCHPAD storage — save a short key→value note scoped to global/employee/conversation/team. Use for QUICK, KEY-BASED lookups ('preferred_language' → 'es'). For free-form durable facts, knowledge-graph entities, or anything you want to RECALL by similarity later, use `mnemosyne_remember` instead.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["global", "employee", "conversation", "team"] },
        key: {
          type: "string",
          description: "Short snake_case identifier, e.g. 'preferred_language'",
        },
        value: { description: "Any JSON-serializable value." },
      },
      required: ["scope", "key", "value"],
    },
  },
  memory_get: {
    name: "memory_get",
    description:
      "SCRATCHPAD lookup — return the full key→value bag for a given scope. Use when you saved with `memory_set` and need to read it back. For semantic retrieval over durable facts, use `brain_recall`.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["global", "employee", "conversation", "team"] },
      },
      required: ["scope"],
    },
  },
  brain_recall: {
    name: "brain_recall",
    description:
      "Semantic search over DURABLE facts in the workspace brain (stored via `mnemosyne_remember`). Returns the top-K facts ranked by vector similarity + recency + recall frequency. Call this BEFORE answering to surface preferences, traits, prior commitments. For scratchpad key-value retrieval, use `memory_get` instead.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language query, e.g. 'user preferences about meetings'",
        },
        topK: { type: "number", description: "How many facts to return (1-20)", default: 5 },
      },
      required: ["query"],
    },
  },
  memory_remove: {
    name: "memory_remove",
    description:
      "SCRATCHPAD eviction — delete a single key or the entire bag for a scope. Use only for entries written with `memory_set`. Durable facts saved through `mnemosyne_remember` are closed via the brain's bitemporal model and shouldn't be reached from this tool.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["global", "employee", "conversation", "team"] },
        key: { type: "string" },
      },
      required: ["scope"],
    },
  },
  // v1.5 — Mnemosyne durable-fact tool. The handler lives in
  // lib/agent-tools/mnemosyne-remember.ts (not in the executeTool
  // switch below) so the policy + PII pipeline stays isolated. The
  // definition is registered here so `getToolDefinitions` surfaces it
  // when the agent's `tools` config opts in.
  mnemosyne_remember: {
    name: "mnemosyne_remember",
    description:
      "BRAIN write — persist a durable, free-form fact about the user, their company, or the conversation. The fact is embedded for semantic search via `brain_recall` and surfaced on future turns. Use for preferences, traits, decisions, events, learned facts — anything you'd want recalled by meaning rather than a key. For ephemeral key→value scratchpad notes, use `memory_set` instead.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["preference", "trait", "event", "relationship", "skill", "concern", "other"],
          description: "Discriminator for the fact type.",
        },
        subject: {
          type: "string",
          description: "Who/what the statement is about ('user', employee name, 'workspace').",
        },
        statement: {
          type: "string",
          description: "Natural-language body of the fact.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Caller confidence in the fact (0..1). Defaults to 0.7.",
        },
        scope: {
          type: "string",
          enum: ["global", "conversation", "employee", "team"],
          description:
            "Storage scope. Omit to use the agent's policy default. Sensitive PII may force a downgrade regardless.",
        },
      },
      required: ["kind", "subject", "statement"],
    },
  },

  // ── Odoo ──────────────────────────────────────────────────────────────────
  // Estas tres se resuelven contra el connector `odoo` (ver ODOO_TOOLS abajo),
  // igual que haría `run_integration`. Existen aparte porque `run_integration`
  // le entrega al modelo `input: {type: "object"}` sin propiedades: el modelo
  // tiene que adivinar la forma del payload y el nombre de la acción. Acá el
  // contrato es explícito y el enum de prioridad es inviolable.
  odoo_create_ticket: {
    name: "odoo_create_ticket",
    description:
      "Create a helpdesk ticket in Odoo. Search first with `odoo_search_tickets` to avoid filing a duplicate. Keep `name` to a single line; put the full report in `description_text`.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Ticket title, one line. E.g. '500s in user-service after 14:20 deploy'.",
        },
        description_text: {
          type: "string",
          description:
            "Body as plain text. Escaped and line breaks preserved on the way in — do not send HTML or Markdown.",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Omit to let Odoo apply its own default.",
        },
        team_id: { type: "number", description: "Helpdesk team id, when known." },
        tag_ids: {
          type: "array",
          items: { type: "number" },
          description: "Tag ids to apply.",
        },
      },
      required: ["name"],
    },
  },
  odoo_post_note: {
    name: "odoo_post_note",
    description:
      "Post an INTERNAL note on an existing Odoo ticket or task. Internal means the customer never sees it — this is where the full technical analysis goes.",
    inputSchema: {
      type: "object",
      properties: {
        model: {
          type: "string",
          enum: ["helpdesk.ticket", "project.task"],
          description: "Defaults to helpdesk.ticket.",
        },
        id: { type: "number", description: "Numeric id of the ticket or task." },
        body_text: { type: "string", description: "Note as plain text." },
        marker: {
          type: "string",
          description:
            "Optional idempotency key (letters, digits, . _ : -). If a note with this marker already exists on the record, nothing is posted.",
        },
      },
      required: ["id", "body_text"],
    },
  },
  // ── Odoo project tasks ────────────────────────────────────────────────────
  // Tasks are a different model from helpdesk tickets, and the ticket tools do
  // not reach them. Without these the only route was `run_integration` with
  // Odoo's `execute`, which calls any method on any model: reading one project
  // meant holding a write primitive for the whole database.
  odoo_get_task: {
    name: "odoo_get_task",
    description:
      "Read one Odoo project task by id. This is the record an incident lives in — the id is the last segment of its URL, /odoo/project/<p>/tasks/<id>. It returns the task's own fields, including `parent_id` and `child_ids`; its evidence is in the notes, via `odoo_get_task_notes`. When the description is empty, the report is usually in a subtask: read the children. A parent often groups the same complaint from several customers, so the siblings widen the picture.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Numeric task id." } },
      required: ["id"],
    },
  },
  odoo_search_tasks: {
    name: "odoo_search_tasks",
    description:
      "Search Odoo project tasks by title, project, stage or creation date. Use it to find whether an incident is already filed, and to find its neighbours — the same defect reported three times is three tasks with near-identical titles.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Matched against the task title." },
        description_query: {
          type: "string",
          description:
            "Matched against the task body. Finds the same complaint filed under a different title.",
        },
        project_id: { type: "number", description: "Restrict to one project." },
        project_ids: {
          type: "array",
          items: { type: "number" },
          description: "Restrict to any of these projects.",
        },
        tag_id: { type: "number", description: "Only tasks carrying this tag." },
        user_id: { type: "number", description: "Only tasks assigned to this user." },
        stage_id: { type: "number", description: "Restrict to one stage." },
        stage_ids: {
          type: "array",
          items: { type: "number" },
          description:
            "Restrict to any of these stages. Stage names change with the user's language: use ids from odoo_list_stages.",
        },
        parent_id: {
          type: "number",
          description:
            "Only the subtasks of this task. Pass a task's own parent_id to list its siblings.",
        },
        closed_since: {
          type: "string",
          description:
            "ISO 8601, in UTC. Tasks whose last stage change is at or after this instant; with the Done stage in stage_ids and include_archived, lists recent closures.",
        },
        name_prefix: {
          type: "string",
          description:
            "Support catalogue code the title starts with, e.g. '1.2.28'. Matches the start of the title only.",
        },
        created_since: {
          type: "string",
          description:
            "ISO 8601, in UTC. Odoo stores create_date in UTC; a local time shifts the window silently.",
        },
        include_archived: {
          type: "boolean",
          description:
            "Also search archived tasks. Done cards are archived, so set this to find earlier occurrences of an issue. Defaults to false.",
        },
        limit: { type: "number", description: "Max rows, capped at 100. Defaults to 20." },
      },
    },
  },
  odoo_get_case: {
    name: "odoo_get_case",
    description:
      "Read a whole bug case in ONE call: the task, its parent, its subtasks (up to 20), its siblings when it is a subtask, the latest notes of the task and of each subtask as plain text, and attachment counts per task (no file contents). Use it first when you start working a case, instead of chaining odoo_get_task, a children search and odoo_get_task_notes. Use odoo_get_task only for a single record, and odoo_get_task_attachments when you need the screenshots themselves.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Numeric task id." },
        notes_per_task: {
          type: "number",
          description: "Latest notes kept per task, max 20. Defaults to 5.",
        },
      },
      required: ["id"],
    },
  },
  odoo_get_task_notes: {
    name: "odoo_get_task_notes",
    description:
      "The notes on a project task, newest first. The pipeline leaves its evidence here — errors, trace and deploys — so read this before going to New Relic: the answer may already be on the ticket.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Numeric task id." },
        limit: { type: "number", description: "Max notes, capped at 100. Defaults to 20." },
        exclude_tracking: {
          type: "boolean",
          description:
            "Defaults to true: only comments and emails, without field-change tracking noise. Pass false to see everything.",
        },
        subtype: {
          type: ["number", "string"],
          description: "Only messages of this subtype id (or display name, which is translated).",
        },
      },
      required: ["id"],
    },
  },
  odoo_get_task_attachments: {
    name: "odoo_get_task_attachments",
    description:
      "List all Odoo task attachment metadata. Set include_images=true when screenshots are evidence you need to inspect: returns up to four newest PNG/JPEG/GIF/WebP images (1 MB each) for visual analysis.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Numeric task id." },
        include_images: { type: "boolean", default: false },
      },
      required: ["id"],
    },
  },
  odoo_get_ticket: {
    name: "odoo_get_ticket",
    description:
      "Read one Odoo helpdesk ticket by id. Tickets are a different model from project tasks: use `odoo_get_task` for the latter.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Numeric ticket id." } },
      required: ["id"],
    },
  },
  odoo_get_partner: {
    name: "odoo_get_partner",
    description:
      "Read one Odoo customer (res.partner) by id: name, vat, is_company, parent_id, email and country. The `vat` is the link to the company in the HR platform: it is that company's fiscal code, so match on it rather than on the name.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Numeric partner id." } },
      required: ["id"],
    },
  },
  odoo_list_stages: {
    name: "odoo_list_stages",
    description:
      "List the stages of an Odoo project in board order (id, name, sequence, folded). Use it instead of hardcoding stage ids, which differ per project and change when the board is edited.",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "number", description: "Numeric project id." } },
      required: ["project_id"],
    },
  },
  odoo_search_tickets: {
    name: "odoo_search_tickets",
    description:
      "Search Odoo helpdesk tickets by title substring. Call this BEFORE creating a ticket: the same incident reported twice is worse than not reported at all.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Matched against the ticket title." },
        limit: { type: "number", description: "Max rows, capped at 100. Defaults to 20." },
      },
    },
  },

  // ── New Relic ─────────────────────────────────────────────────────────────
  // Contexto que un payload de alerta no trae. Las tres queries son fijas: un
  // resultado reproducible entre corridas vale más que la flexibilidad de
  // dejar que el modelo escriba NRQL.
  newrelic_get_errors: {
    name: "newrelic_get_errors",
    description:
      "Top errors for an application in a recent window, grouped by class and message. Start here when an alert names a service but not a cause.",
    inputSchema: {
      type: "object",
      properties: {
        app_name: {
          type: "string",
          description: "APM application name exactly as New Relic reports it, e.g. user-service.",
        },
        since_minutes: {
          type: "number",
          description: "Window in minutes, capped at 1440. Defaults to 30.",
        },
        limit: { type: "number", description: "Max rows, capped at 100." },
      },
      required: ["app_name"],
    },
  },
  newrelic_get_logs_for_trace: {
    name: "newrelic_get_logs_for_trace",
    description:
      "Log lines for one distributed trace, oldest first. Use the `trace_id` carried by the alert payload — this is how a single failing request is reconstructed end to end.",
    inputSchema: {
      type: "object",
      properties: {
        trace_id: {
          type: "string",
          description: "The trace id from the alert payload or from a log line.",
        },
        limit: { type: "number", description: "Max rows, capped at 100." },
      },
      required: ["trace_id"],
    },
  },
  newrelic_get_deployments: {
    name: "newrelic_get_deployments",
    description:
      "Recent deployments for an application. Check this before blaming code: a spike that starts right after a rollout is usually the rollout.",
    inputSchema: {
      type: "object",
      properties: {
        app_name: { type: "string" },
        limit: { type: "number" },
      },
      required: ["app_name"],
    },
  },

  // ── GitLab ────────────────────────────────────────────────────────────────
  // Read-only, and narrow on purpose. The connector exposes these actions
  // already; what was missing was a named tool for each, so the alternative
  // was handing the agent `run_integration` — which reaches ANY action of ANY
  // integration, including Odoo's `execute`, i.e. arbitrary model methods.
  // A tool per capability is the difference between a key and a master key.
  //
  // There is no blame action and the API has no blame endpoint here, so "when
  // did this line appear" is answered with `gitlab_list_commits` on the file's
  // path. That is the history of the file, not of the line: say so rather than
  // presenting the newest commit as the one that introduced it.
  gitlab_search_code: {
    name: "gitlab_search_code",
    description:
      "Search source code across a project or a group. Use the error message or the symbol from a stack trace verbatim — searching for the error CLASS finds the thrower, searching for the MESSAGE finds the line.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["project", "group"],
          description: "Search one project or a whole group.",
        },
        id: {
          type: "string",
          description: "Project or group, as a numeric id or a full path like 'team/service'.",
        },
        query: { type: "string", description: "Matched against file contents." },
        onlySource: {
          type: "boolean",
          description: "Drop hits in tests, fixtures and lock files. Defaults to true.",
        },
        ref: { type: "string", description: "Branch or tag. Defaults to the default branch." },
        limit: { type: "number", description: "Max hits." },
      },
      required: ["scope", "id", "query"],
    },
  },
  gitlab_read_file: {
    name: "gitlab_read_file",
    description:
      "Read a file from a repository. Pass `aroundLine` to get just the window around a line instead of the whole file — a stack trace gives you that number, and a whole file spends context you will want for the analysis.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Numeric id or full path like 'team/service'." },
        path: { type: "string", description: "Path inside the repository." },
        aroundLine: { type: "number", description: "Centre the window on this line." },
        contextLines: { type: "number", description: "Lines each side of `aroundLine`." },
        ref: { type: "string", description: "Branch, tag or commit SHA." },
      },
      required: ["project", "path"],
    },
  },
  gitlab_list_commits: {
    name: "gitlab_list_commits",
    description:
      "Commits that touched a path, newest first. This is how you date a change: pass the file's path and the window around the incident. It returns no diffs, and it is the history of the FILE — the newest commit touching it is not necessarily the one that introduced the line.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Numeric id or full path like 'team/service'." },
        path: { type: "string", description: "Restrict to commits touching this path." },
        since: { type: "string", description: "ISO 8601 lower bound." },
        until: { type: "string", description: "ISO 8601 upper bound." },
        limit: { type: "number", description: "Max commits." },
      },
      required: ["project"],
    },
  },
};

/**
 * Tools tipadas que delegan en una acción de un connector. El modelo ve el
 * schema de la tool; la credencial y la validación viven server-side, igual
 * que en `run_integration`.
 */
const CONNECTOR_TOOLS: Record<
  string,
  { integrationId: string; action: string; defaults?: Record<string, unknown> }
> = {
  odoo_create_ticket: { integrationId: "odoo", action: "create_ticket" },
  odoo_post_note: { integrationId: "odoo", action: "post_note" },
  odoo_search_tickets: { integrationId: "odoo", action: "search_tickets" },
  odoo_get_ticket: { integrationId: "odoo", action: "get_ticket" },
  odoo_get_task_attachments: { integrationId: "odoo", action: "get_task_attachments" },
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
  newrelic_get_deployments: { integrationId: "newrelic", action: "get_deployments" },
  gitlab_search_code: { integrationId: "gitlab", action: "search_code" },
  gitlab_read_file: { integrationId: "gitlab", action: "read_file" },
  gitlab_list_commits: { integrationId: "gitlab", action: "list_commits" },
};

export function getToolDefinitions(enabledIds: string[]): ToolDefinition[] {
  return enabledIds.map((id) => BUILTINS[id]).filter(Boolean) as ToolDefinition[];
}

/**
 * `knowledge_search` as the model sees it for an agent bound to knowledge
 * bases: kbId becomes optional and the agent's bases are listed by name.
 */
function boundKnowledgeSearch(kbs: { id: string; name: string }[]): ToolDefinition {
  const base = BUILTINS.knowledge_search!;
  const props = (base.inputSchema as { properties: Record<string, Record<string, unknown>> })
    .properties;
  const list = kbs.map((kb) => `${kb.name} (${kb.id})`).join("; ");
  return {
    ...base,
    description: `${base.description} This agent can search these knowledge bases: ${list}. Omit kbId to search all of them at once.`,
    inputSchema: {
      ...base.inputSchema,
      properties: {
        ...props,
        kbId: {
          type: "string",
          description: `Optional. One of: ${list}. Omit to search all of them.`,
          enum: kbs.map((kb) => kb.id),
        },
      },
      required: ["query"],
    },
  };
}

export async function resolveToolDefinitions(
  workspaceId: string,
  enabledIds: string[],
  tx?: WsDb,
  agent?: { id?: string; config?: unknown }
): Promise<ToolDefinition[]> {
  let builtins = getToolDefinitions(enabledIds);
  if (agent && enabledIds.includes("knowledge_search")) {
    const { readAgentKbIds, listWorkspaceKbs } = await import("./agents/knowledge-bases");
    const kbs = await listWorkspaceKbs(workspaceId, readAgentKbIds(agent.config), tx);
    if (kbs.length)
      builtins = builtins.map((d) =>
        d.name === "knowledge_search" ? boundKnowledgeSearch(kbs) : d
      );
  }
  if (!enabledIds.some((id) => id.startsWith("mcp__"))) return builtins;
  const { listWorkspaceMcpTools } = await import("./integrations/mcp-tools");
  const remote = await listWorkspaceMcpTools(workspaceId, tx);
  return [...builtins, ...remote.filter((tool) => enabledIds.includes(tool.name))];
}

export function listAllTools(): ToolDefinition[] {
  return Object.values(BUILTINS);
}

/** Safe shunting-yard arithmetic evaluator (no JS eval). Supports + - * / % ( ). */
function safeEvalArithmetic(expr: string): number {
  // Tokenize
  const tokens: Array<string | number> = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j]!)) j++;
      tokens.push(Number(expr.slice(i, j)));
      i = j;
      continue;
    }
    if ("+-*/%()".includes(c)) {
      tokens.push(c);
      i++;
      continue;
    }
    throw new Error(`Invalid character: ${c}`);
  }
  // Shunting-yard
  const out: Array<string | number> = [];
  const ops: string[] = [];
  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2 };
  for (const t of tokens) {
    if (typeof t === "number") {
      out.push(t);
    } else if (t === "(") {
      ops.push(t);
    } else if (t === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop()!);
      if (!ops.length) throw new Error("Mismatched parentheses");
      ops.pop();
    } else {
      while (
        ops.length &&
        ops[ops.length - 1] !== "(" &&
        (prec[ops[ops.length - 1]!] ?? 0) >= (prec[t] ?? 0)
      ) {
        out.push(ops.pop()!);
      }
      ops.push(t);
    }
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op === "(") throw new Error("Mismatched parentheses");
    out.push(op);
  }
  // Evaluate RPN
  const stack: number[] = [];
  for (const t of out) {
    if (typeof t === "number") {
      stack.push(t);
    } else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) throw new Error("Invalid expression");
      let r: number;
      if (t === "+") r = a + b;
      else if (t === "-") r = a - b;
      else if (t === "*") r = a * b;
      else if (t === "/") {
        if (b === 0) throw new Error("Division by zero");
        r = a / b;
      } else if (t === "%") r = a % b;
      else throw new Error(`Unknown op: ${t}`);
      stack.push(r);
    }
  }
  if (stack.length !== 1) throw new Error("Invalid expression");
  const result = stack[0]!;
  if (!isFinite(result)) throw new Error("Result is not finite");
  return result;
}

/** Team of the calling agent, or null when it has none / cannot be found. */
async function getCallerTeamId(
  db: ReturnType<typeof getDb>,
  agentId: string,
  workspaceId: string
): Promise<string | null> {
  const rows = await db
    .select({ teamId: schema.agents.teamId })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.workspaceId, workspaceId)))
    .limit(1);
  return rows[0]?.teamId ?? null;
}

/**
 * Whether a tool call reads or writes, so a dry run can let reads through and
 * simulate writes. Connector-backed tools inherit their action's declared
 * effect; the rest are classified here. Anything not classified is `write`: an
 * unclassified tool must never run in a dry run.
 */
const READ_TOOLS = new Set([
  "current_time",
  "calculator",
  "agent_team_list",
  "knowledge_search",
  "memory_get",
  "brain_recall",
]);

export async function toolEffect(
  name: string,
  input: Record<string, unknown>,
  ctx: Pick<ToolContext, "workspaceId" | "tx">
): Promise<"read" | "write"> {
  if (READ_TOOLS.has(name)) return "read";
  if (name === "http_request") {
    const method = String(input.method ?? "GET").toUpperCase();
    return method === "GET" || method === "HEAD" ? "read" : "write";
  }
  const route = CONNECTOR_TOOLS[name];
  if (route) {
    const { getConnector, actionEffect } = await import("@/lib/integrations/registry");
    const connector = getConnector(route.integrationId);
    if (!connector) throw new Error("Connector desconocido");
    const routed = connector.actions[route.action];
    if (!routed) throw new Error(`Acción desconocida: ${route.action}`);
    return actionEffect(routed, input);
  }
  if (name === "run_integration") {
    const integrationId = String(input.integrationId ?? "");
    const action = String(input.action ?? "");
    if (!integrationId || !action) return "write";
    // Unresolvable integration/action: let the lookup error surface, the same
    // one the real run raises, rather than simulating it as a write.
    const { getIntegrationActionEffect } = await import("@/lib/integrations/store");
    return getIntegrationActionEffect(
      ctx.workspaceId,
      integrationId,
      action,
      (input.input as Record<string, unknown>) ?? {},
      ctx.tx
    );
  }
  // Workspace MCP tools are classified by the loop from their definition.
  if (name.startsWith("mcp__")) return "write";
  // flow_call, agent_handoff, memory_set, memory_remove, mnemosyne_remember, and
  // any built-in nobody classified yet are writes; a name that is not a tool at
  // all is an error, not a write to simulate.
  if (!listAllTools().some((t) => t.name === name)) throw new Error(`Unknown tool: ${name}`);
  return "write";
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<unknown> {
  if (name.startsWith("mcp__")) {
    const { executeWorkspaceMcpTool } = await import("./integrations/mcp-tools");
    return executeWorkspaceMcpTool(name, input, ctx);
  }
  if (name === "current_time") {
    const tz = (input.timezone as string) ?? "UTC";
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      return { iso: now.toISOString(), formatted: formatter.format(now), timezone: tz };
    } catch {
      return { iso: new Date().toISOString(), timezone: "UTC" };
    }
  }

  if (name === "calculator") {
    const expr = String(input.expression ?? "");
    if (!expr) throw new Error("expression required");
    const result = safeEvalArithmetic(expr);
    return { expression: expr, result };
  }

  if (name === "http_request") {
    const url = String(input.url ?? "");
    // Hardened SSRF guard: bloquea loopback, RFC1918, link-local (incl. cloud
    // metadata 169.254.169.254), IPv6 ULA/link-local, *.local/*.internal y
    // esquemas no http(s). Opt-out `ALLOW_PRIVATE_HTTP=1` consistente con el
    // nodo `http` del flow-engine, para self-hosters con servicios internos.
    if (process.env.ALLOW_PRIVATE_HTTP !== "1") {
      assertPublicUrl(url);
    }
    const method = (input.method as string) ?? "GET";
    const init: RequestInit = {
      method,
      headers: (input.headers as Record<string, string>) ?? { Accept: "application/json" },
    };
    if (method !== "GET" && input.body !== undefined) init.body = String(input.body);
    const r = await fetchWithTimeout(url, init, HTTP_REQUEST_TIMEOUT_MS);
    const text = await r.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {}
    return { status: r.status, body };
  }

  if (name === "flow_call") {
    const flowId = String(input.flowId ?? "");
    if (!flowId) throw new Error("flowId required");
    // F-B1: async — el agente puede correr flows largos (video/avatar) sin
    // bloquear el turno conversacional. Devolvemos runId y el agente puede
    // chequear /api/flow-runs/:runId después.
    const { enqueueFlowRun } = await import("./flow-engine");
    const result = await enqueueFlowRun({
      flowId,
      workspaceId: ctx.workspaceId,
      triggerSource: `tool_call`,
      input: (input.input as Record<string, unknown>) ?? {},
    });
    return result;
  }

  if (name === "agent_team_list") {
    const db = ctx.tx ?? getDb();
    const conds = [
      eq(schema.agents.workspaceId, ctx.workspaceId),
      eq(schema.agents.status, "active"),
    ];
    if (ctx.agentId) {
      conds.push(ne(schema.agents.id, ctx.agentId));
      // Scope to the caller's team. An agent with no team (or a call with no
      // agent context, e.g. from a flow) keeps the workspace-wide list.
      const callerTeamId = await getCallerTeamId(db, ctx.agentId, ctx.workspaceId);
      if (callerTeamId) conds.push(eq(schema.agents.teamId, callerTeamId));
    }
    const teammates = await db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        role: schema.agents.role,
        teamId: schema.agents.teamId,
      })
      .from(schema.agents)
      .where(and(...conds));
    return { teammates };
  }

  if (name === "agent_handoff") {
    if (!ctx.agentId) throw new Error("agent_handoff requires the calling agent context");
    if (!ctx.conversationId) {
      throw new Error(
        "agent_handoff requires conversationId — only available in conversational runs"
      );
    }
    const targetAgentId = String(input.agentId ?? "");
    const note = String(input.note ?? "").slice(0, 1000);
    if (!targetAgentId) throw new Error("agentId required");
    if (targetAgentId === ctx.agentId) throw new Error("cannot hand off to yourself");

    const db = ctx.tx ?? getDb();

    // Validate target agent exists in same workspace and is active
    const targetRows = await db
      .select()
      .from(schema.agents)
      .where(
        and(eq(schema.agents.id, targetAgentId), eq(schema.agents.workspaceId, ctx.workspaceId))
      )
      .limit(1);
    const target = targetRows[0];
    if (!target) throw new Error(`target agent ${targetAgentId} not found in workspace`);
    if (target.status !== "active") {
      throw new Error(`target agent ${target.name} is not active (status=${target.status})`);
    }
    // Same scoping as agent_team_list: a caller in a team may only hand off
    // within it, otherwise the model could use an id it saw elsewhere.
    const callerTeamId = await getCallerTeamId(db, ctx.agentId, ctx.workspaceId);
    if (callerTeamId && target.teamId !== callerTeamId) {
      throw new Error(`target agent ${target.name} is not in your team`);
    }

    // Pivot the conversation to the new agent
    await db
      .update(schema.conversations)
      .set({ agentId: targetAgentId })
      .where(eq(schema.conversations.id, ctx.conversationId));

    // Persist a system message with the handoff note for auditability and so
    // the next agent's history-compaction sees it as context.
    await db.insert(schema.messages).values({
      id: createId(),
      conversationId: ctx.conversationId,
      role: "system",
      content: `[handoff] from agentId=${ctx.agentId} to agentId=${targetAgentId} — ${note}`,
      metadata: {
        kind: "agent_handoff",
        fromAgentId: ctx.agentId,
        toAgentId: targetAgentId,
        note,
      },
    });

    await logAudit({
      workspaceId: ctx.workspaceId,
      action: "agent.handoff",
      resource: "conversation",
      resourceId: ctx.conversationId,
      after: { fromAgentId: ctx.agentId, toAgentId: targetAgentId, note },
    });

    return {
      ok: true,
      handedOffTo: { id: target.id, name: target.name, role: target.role },
      note,
    };
  }

  if (name === "memory_set" || name === "memory_get" || name === "memory_remove") {
    if (!ctx.agentId) throw new Error("memory_* tools require ctx.agentId");
    const { setMemory, getRelevantMemories, removeMemory } = await import("./memory");
    const scope = String(input.scope ?? "global") as
      "global" | "conversation" | "employee" | "team";
    const baseQ = {
      agentId: ctx.agentId,
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      employeeId: ctx.employeeId,
    };
    if (name === "memory_set") {
      const key = String(input.key ?? "");
      if (!key) throw new Error("key required");
      const value = input.value;
      const out = await setMemory({ ...baseQ, scope, key, value }, ctx.tx);
      return { ok: true, scope, data: out.data };
    }
    if (name === "memory_get") {
      const matches = await getRelevantMemories(baseQ, ctx.tx);
      const filtered = matches.filter((m) => m.scope === scope);
      return {
        scope,
        data: filtered[0]?.data ?? {},
      };
    }
    if (name === "memory_remove") {
      const key = input.key != null ? String(input.key) : null;
      await removeMemory({ ...baseQ, scope, key }, ctx.tx);
      return { ok: true, scope, removed: key ?? "all" };
    }
  }

  if (name === "brain_recall") {
    const query = String(input.query ?? "");
    if (!query) throw new Error("query required");
    // Recall dispatches via `recallForWorkspace`, which embeds the
    // query host-side with the workspace's encrypted `ai_provider`
    // row and forwards the precomputed vector to the mnemosyne SDK.
    // `RecallHit.content` is the fact statement, `score` blends memory
    // + KB similarity, and `attribution` carries the kind/subject.
    const { recallForWorkspace } = await import("@/lib/mnemo/recall");
    const { hits } = await recallForWorkspace({
      workspaceId: ctx.workspaceId,
      query,
      topK: Math.min(Number(input.topK ?? 5), 20),
      ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
    });
    return {
      hits: hits.map((h) => {
        const attr = (h.attribution ?? {}) as { kind?: string; subject?: string };
        return {
          kind: attr.kind ?? "fact",
          subject: attr.subject ?? "",
          statement: h.content,
          score: Number(h.score.toFixed(3)),
        };
      }),
    };
  }

  if (name === "knowledge_search") {
    const kbId = String(input.kbId ?? "");
    const query = String(input.query ?? "");
    const { searchKnowledgeBase } = await import("./knowledge-search");
    // An agent bound to knowledge bases may only read those, and may omit kbId.
    const bound = ctx.agentId
      ? await (
          await import("./agents/knowledge-bases")
        ).agentKbs(ctx.workspaceId, ctx.agentId, ctx.tx)
      : [];
    if (bound.length) {
      if (!query) throw new Error("query required");
      if (kbId && !bound.some((kb) => kb.id === kbId))
        throw new Error(`Knowledge base ${kbId} is not one of this agent's knowledge bases.`);
      const topK = Number(input.topK ?? 5);
      const targets = kbId ? [kbId] : bound.map((kb) => kb.id);
      const lists = await Promise.all(
        targets.map((id) => searchKnowledgeBase(ctx.workspaceId, id, query, topK, ctx.tx))
      );
      const limit = Math.min(20, Math.max(1, topK || 5));
      const results = lists
        .flat()
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return { results };
    }
    if (!kbId || !query) throw new Error("kbId and query required");
    const results = await searchKnowledgeBase(
      ctx.workspaceId,
      kbId,
      query,
      Number(input.topK ?? 5),
      ctx.tx
    );
    return { results };
  }

  if (name === "run_integration") {
    const integrationId = String(input.integrationId ?? "");
    const action = String(input.action ?? "");
    if (!integrationId || !action) throw new Error("integrationId y action son requeridos");
    const { runIntegrationAction } = await import("@/lib/integrations/store");
    return runIntegrationAction(
      ctx.workspaceId,
      integrationId,
      action,
      (input.input as Record<string, unknown>) ?? {},
      ctx.tx
    );
  }

  const connectorTool = CONNECTOR_TOOLS[name];
  if (connectorTool) {
    const { runIntegrationAction } = await import("@/lib/integrations/store");
    return runIntegrationAction(
      ctx.workspaceId,
      connectorTool.integrationId,
      connectorTool.action,
      connectorTool.defaults ? { ...connectorTool.defaults, ...input } : input,
      ctx.tx
    );
  }

  throw new Error(`Unknown tool: ${name}`);
}
