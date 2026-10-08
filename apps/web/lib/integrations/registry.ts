import "server-only";
import {
  MAX_TOOL_IMAGE_BYTES,
  MAX_TOOL_IMAGES,
  MAX_TOOL_IMAGES_HARD,
  MIN_TOOL_IMAGE_BYTES,
  normalizeToolOutput,
} from "../tool-output";
import { MAX_TABLE_FILE_BYTES, maskSensitive, readXlsx, tableFromCsv } from "./attachment-table";
import { discordWebhookUrl, discordSendMessage, discordSendEmbed } from "./discord-client";
import { telegramTest, telegramSendMessage } from "./telegram-client";
import {
  gitlabTest,
  gitlabSearchCode,
  gitlabReadFile,
  gitlabCompareRefs,
  gitlabListCommits,
  gitlabGetMergeRequest,
  gitlabListMergeRequests,
  gitlabGetDiff,
} from "./gitlab-client";
import {
  odooAuthenticate,
  odooExecute,
  htmlFromText,
  x2manyReplace,
  TICKET_PRIORITY,
  type TicketPriority,
} from "./odoo-client";
import { htmlToText } from "./html-text";
import { markdownToHtml } from "@/lib/text/markdown-html";
import {
  nerdgraph,
  runNrql,
  looksLikeUserKey,
  buildErrorsQuery,
  buildTraceLogsQuery,
  buildDeploymentsQuery,
  buildBrowserErrorsQuery,
  buildSearchLogsQuery,
  BROWSER_ERRORS_LIMIT,
  LOG_LEVELS,
} from "./newrelic-client";

/**
 * Registry de integraciones de terceros.
 *
 * Cada connector define: cómo se configura (fields), cómo se testea la
 * credencial (test), y qué acciones expone (actions) — que luego se ofrecen
 * como tools de agente. Los connectors token-based funcionan 100% sin que el
 * operador registre apps OAuth; los OAuth quedan con el flow listo esperando
 * client IDs.
 */

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  placeholder?: string;
  required?: boolean;
  help?: string;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

/**
 * What an action does to the outside world. A dry run executes `read` actions
 * (real context is the point) and simulates `write` ones. It may depend on the
 * input — the generic `execute` and `request` actions are only as safe as the
 * method they are given.
 */
export type ActionEffect = "read" | "write";

export interface ConnectorAction {
  description: string;
  effect: ActionEffect | ((input: Record<string, unknown>) => ActionEffect);
  /**
   * Input keys that decide a function `effect` (nothing else is read). Lets a
   * static description trust the effect when those keys are literal even if
   * other keys hold `{{templates}}`. Omitted: the whole input counts.
   */
  effectKeys?: readonly string[];
  inputSchema: JsonSchema;
  run: (config: Record<string, string>, input: Record<string, unknown>) => Promise<unknown>;
}

/** Odoo model methods that only read. Anything else through `execute` writes. */
const ODOO_READ_METHODS: ReadonlySet<string> = new Set([
  "search_read",
  "read",
  "search_count",
  "fields_get",
  "name_search",
]);
const SAFE_HTTP_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * Resolves an action's effect for a given input. A missing declaration is
 * `write`: an action nobody classified must never run in a dry run.
 */
export function actionEffect(
  action: Pick<ConnectorAction, "effect"> | undefined,
  input: Record<string, unknown>
): ActionEffect {
  const e = action?.effect as ConnectorAction["effect"] | undefined;
  if (typeof e === "function") return e(input) === "read" ? "read" : "write";
  return e === "read" ? "read" : "write";
}

/**
 * The effect to report for a step whose input may still hold `{{templates}}`,
 * or undefined when it cannot be told without running. Never guesses:
 * - a fixed effect does not depend on the input, so it is always known;
 * - a computed effect with `effectKeys` is known when those keys are literal;
 * - a computed effect without `effectKeys` is trusted as `write`, and as
 *   `read` only when no part of the input is templated.
 */
export function describedActionEffect(
  action: Pick<ConnectorAction, "effect" | "effectKeys"> | undefined,
  input: Record<string, unknown>
): ActionEffect | undefined {
  const effect = actionEffect(action, input);
  if (typeof action?.effect !== "function") return effect;
  const templated = (v: unknown) => /\{\{/.test(JSON.stringify(v) ?? "");
  if (action.effectKeys) {
    return action.effectKeys.some((k) => templated(input[k])) ? undefined : effect;
  }
  return effect === "write" || !templated(input) ? effect : undefined;
}

export interface TestResult {
  ok: boolean;
  meta?: Record<string, unknown>;
  error?: string;
}

export interface Connector {
  id: string;
  name: string;
  description: string;
  category: "messaging" | "data" | "payments" | "productivity" | "email" | "custom";
  authType: "token" | "oauth" | "connection_string";
  /** True if the connector requires the operator to register an OAuth app (it can't work without their own credentials). */
  needsOAuthApp?: boolean;
  fields: ConfigField[];
  test: (config: Record<string, string>) => Promise<TestResult>;
  actions: Record<string, ConnectorAction>;
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), init.timeoutMs ?? 10_000);
  try {
    const r = await fetch(url, { ...init, signal: ac.signal });
    const text = await r.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* texto plano */
    }
    return { ok: r.ok, status: r.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

// ── Connectors ──────────────────────────────────────────────────────────────

const stripe: Connector = {
  id: "stripe",
  name: "Stripe",
  description: "Read balance, customers, and invoices. Read-only operations with your secret key.",
  category: "payments",
  authType: "token",
  fields: [
    {
      key: "secretKey",
      label: "Secret key",
      type: "password",
      placeholder: "sk_live_… or sk_test_…",
      required: true,
      help: "Stripe → Developers → API keys.",
    },
  ],
  async test(config) {
    const r = await fetchJson("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${config.secretKey}` },
    });
    if (!r.ok)
      return {
        ok: false,
        error: `Stripe ${r.status}: ${(r.json as { error?: { message?: string } })?.error?.message ?? r.text.slice(0, 120)}`,
      };
    const mode = config.secretKey?.startsWith("sk_live") ? "live" : "test";
    return { ok: true, meta: { mode } };
  },
  actions: {
    get_balance: {
      effect: "read",
      description: "Return the available and pending balance of the Stripe account.",
      inputSchema: { type: "object", properties: {} },
      async run(config) {
        const r = await fetchJson("https://api.stripe.com/v1/balance", {
          headers: { Authorization: `Bearer ${config.secretKey}` },
        });
        return r.json;
      },
    },
    list_customers: {
      effect: "read",
      description: "List the most recent Stripe customers.",
      inputSchema: { type: "object", properties: { limit: { type: "number" } } },
      async run(config, input) {
        const limit = Math.min(100, Number(input.limit ?? 10));
        const r = await fetchJson(`https://api.stripe.com/v1/customers?limit=${limit}`, {
          headers: { Authorization: `Bearer ${config.secretKey}` },
        });
        return r.json;
      },
    },
    list_invoices: {
      effect: "read",
      description: "List the most recent Stripe invoices.",
      inputSchema: { type: "object", properties: { limit: { type: "number" } } },
      async run(config, input) {
        const limit = Math.min(100, Number(input.limit ?? 10));
        const r = await fetchJson(`https://api.stripe.com/v1/invoices?limit=${limit}`, {
          headers: { Authorization: `Bearer ${config.secretKey}` },
        });
        return r.json;
      },
    },
  },
};

const notion: Connector = {
  id: "notion",
  name: "Notion",
  description: "Search pages and query databases using an integration token.",
  category: "productivity",
  authType: "token",
  fields: [
    {
      key: "token",
      label: "Integration token",
      type: "password",
      placeholder: "ntn_… or secret_…",
      required: true,
      help: "notion.so/my-integrations → New integration.",
    },
  ],
  async test(config) {
    const r = await fetchJson("https://api.notion.com/v1/users/me", {
      headers: { Authorization: `Bearer ${config.token}`, "Notion-Version": "2022-06-28" },
    });
    if (!r.ok) return { ok: false, error: `Notion ${r.status}: ${r.text.slice(0, 120)}` };
    const name = (r.json as { name?: string; bot?: { workspace_name?: string } })?.bot
      ?.workspace_name;
    return { ok: true, meta: name ? { workspace: name } : {} };
  },
  actions: {
    search: {
      effect: "read",
      description: "Search Notion pages and databases by text.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      async run(config, input) {
        const r = await fetchJson("https://api.notion.com/v1/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Notion-Version": "2022-06-28",
            "content-type": "application/json",
          },
          body: JSON.stringify({ query: String(input.query ?? ""), page_size: 10 }),
        });
        return r.json;
      },
    },
    query_database: {
      effect: "read",
      description: "Query a Notion database by its ID.",
      inputSchema: {
        type: "object",
        properties: { databaseId: { type: "string" } },
        required: ["databaseId"],
      },
      async run(config, input) {
        const r = await fetchJson(
          `https://api.notion.com/v1/databases/${String(input.databaseId)}/query`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.token}`,
              "Notion-Version": "2022-06-28",
              "content-type": "application/json",
            },
            body: JSON.stringify({ page_size: 25 }),
          }
        );
        return r.json;
      },
    },
  },
};

const postgres: Connector = {
  id: "postgres",
  name: "PostgreSQL",
  description: "Connect a READ-ONLY external database so agents can query data.",
  category: "data",
  authType: "connection_string",
  fields: [
    {
      key: "connectionString",
      label: "Connection string",
      type: "password",
      placeholder: "postgresql://user:pass@host:5432/db",
      required: true,
      help: "Use a user with read-only permissions.",
    },
  ],
  async test(config) {
    const cs = config.connectionString ?? "";
    if (!cs) return { ok: false, error: "Connection string required" };
    try {
      const { assertPublicDbHost } = await import("@/lib/net-guard");
      assertPublicDbHost(cs);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "host blocked" };
    }
    const { default: pg } = await import("postgres");
    const sql = pg(cs, { max: 1, idle_timeout: 5, connect_timeout: 8 });
    try {
      const rows = await sql`select current_database() as db, version() as version`;
      return { ok: true, meta: { db: rows[0]?.db } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      await sql.end({ timeout: 2 });
    }
  },
  actions: {
    query: {
      effect: "read",
      description:
        "Run a READ-ONLY SQL query (SELECT) against the external database. Write statements are rejected.",
      inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
      async run(config, input) {
        const raw = String(input.sql ?? "").trim();
        // Defensa 1 (regex): solo SELECT/WITH, bloquea DML/DDL obvios.
        if (
          !/^(select|with)\b/i.test(raw) ||
          /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy)\b/i.test(raw)
        ) {
          throw new Error("Only read-only queries are allowed (SELECT/WITH).");
        }
        const { assertPublicDbHost } = await import("@/lib/net-guard");
        assertPublicDbHost(config.connectionString ?? "");
        const { default: pg } = await import("postgres");
        const sql = pg(config.connectionString ?? "", {
          max: 1,
          idle_timeout: 5,
          connect_timeout: 8,
        });
        try {
          // Defensa 2 (DB): transacción READ ONLY + statement_timeout (anti-DoS,
          // bloquea escritura aunque la regex se evada).
          const rows = await sql.begin(async (tx) => {
            await tx.unsafe("set transaction read only");
            await tx.unsafe("set local statement_timeout = 10000");
            return tx.unsafe(raw);
          });
          const arr = Array.isArray(rows) ? rows : [];
          return { rows: arr.slice(0, 200), rowCount: arr.length };
        } finally {
          await sql.end({ timeout: 2 });
        }
      },
    },
  },
};

const resend: Connector = {
  id: "resend",
  name: "Resend",
  description: "Send transactional emails from your agents and flows.",
  category: "email",
  authType: "token",
  fields: [
    { key: "apiKey", label: "API key", type: "password", placeholder: "re_…", required: true },
    {
      key: "from",
      label: "From",
      type: "text",
      placeholder: "Orchester <no-reply@your-domain.com>",
      required: true,
    },
  ],
  async test(config) {
    const r = await fetchJson("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!r.ok) return { ok: false, error: `Resend ${r.status}: ${r.text.slice(0, 120)}` };
    return { ok: true };
  },
  actions: {
    send_email: {
      effect: "write",
      description: "Send an email via Resend.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          text: { type: "string" },
        },
        required: ["to", "subject", "text"],
      },
      async run(config, input) {
        const r = await fetchJson("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: config.from,
            to: [String(input.to)],
            subject: String(input.subject),
            text: String(input.text),
          }),
        });
        return r.json;
      },
    },
  },
};

const http: Connector = {
  id: "http",
  name: "HTTP / REST",
  description: "Connect any REST API. Bearer token optional. Agents can call it.",
  category: "custom",
  authType: "token",
  fields: [
    {
      key: "baseUrl",
      label: "Base URL",
      type: "url",
      placeholder: "https://api.your-service.com",
      required: true,
    },
    {
      key: "bearerToken",
      label: "Bearer token (optional)",
      type: "password",
      placeholder: "token",
      required: false,
    },
  ],
  async test(config) {
    const baseUrl = config.baseUrl ?? "";
    if (!baseUrl) return { ok: false, error: "Base URL required" };
    try {
      const { assertPublicUrl } = await import("@/lib/net-guard");
      assertPublicUrl(baseUrl);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "URL blocked" };
    }
    try {
      const r = await fetchJson(baseUrl, {
        headers: config.bearerToken ? { Authorization: `Bearer ${config.bearerToken}` } : {},
        timeoutMs: 8000,
      });
      // Cualquier respuesta HTTP (incluso 401/404) significa que el host responde.
      return { ok: true, meta: { reachedStatus: r.status } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  actions: {
    request: {
      effect: (input) =>
        SAFE_HTTP_METHODS.has(String(input.method ?? "GET").toUpperCase()) ? "read" : "write",
      effectKeys: ["method"],
      description:
        "Make an HTTP request to {baseUrl}{path}. method GET/POST/PUT/DELETE; optional JSON body.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          method: { type: "string" },
          body: { type: "object" },
        },
        required: ["path"],
      },
      async run(config, input) {
        const method = String(input.method ?? "GET").toUpperCase();
        const baseUrl = (config.baseUrl ?? "").replace(/\/$/, "");
        const path = String(input.path ?? "");
        const url = baseUrl + (path.startsWith("/") ? "" : "/") + path;
        const { assertPublicUrl } = await import("@/lib/net-guard");
        assertPublicUrl(url);
        const r = await fetchJson(url, {
          method,
          headers: {
            ...(config.bearerToken ? { Authorization: `Bearer ${config.bearerToken}` } : {}),
            ...(input.body ? { "content-type": "application/json" } : {}),
          },
          ...(input.body ? { body: JSON.stringify(input.body) } : {}),
        });
        return { status: r.status, body: r.json ?? r.text };
      },
    },
  },
};

const googleWorkspace: Connector = {
  id: "google",
  name: "Google Workspace",
  description: "Calendar, Drive, Gmail. Requires registering an OAuth app in Google Cloud.",
  category: "productivity",
  authType: "oauth",
  needsOAuthApp: true,
  fields: [
    {
      key: "clientId",
      label: "OAuth Client ID",
      type: "text",
      required: true,
      help: "Google Cloud Console → Credentials.",
    },
    { key: "clientSecret", label: "OAuth Client Secret", type: "password", required: true },
  ],
  async test(config) {
    if (!config.clientId || !config.clientSecret)
      return { ok: false, error: "Missing client ID / secret for the OAuth app." };
    // Without completing the OAuth flow (consent + tokens) we can't call the APIs.
    return {
      ok: false,
      error: "OAuth app configured. Complete the authorization flow to connect (pending consent).",
    };
  },
  actions: {},
};

const slack: Connector = {
  id: "slack",
  name: "Slack",
  description: "Bot messaging. Channel configuration lives in /channels.",
  category: "messaging",
  authType: "token",
  fields: [
    {
      key: "botToken",
      label: "Bot token",
      type: "password",
      placeholder: "xoxb-…",
      required: true,
    },
  ],
  async test(config) {
    const r = await fetchJson("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.botToken}` },
    });
    const j = r.json as { ok?: boolean; team?: string; error?: string };
    if (!j?.ok) return { ok: false, error: `Slack: ${j?.error ?? "auth failed"}` };
    return { ok: true, meta: { team: j.team } };
  },
  actions: {
    post_message: {
      effect: "write",
      description: "Post a message to a Slack channel.",
      inputSchema: {
        type: "object",
        properties: { channel: { type: "string" }, text: { type: "string" } },
        required: ["channel", "text"],
      },
      async run(config, input) {
        const r = await fetchJson("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.botToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ channel: String(input.channel), text: String(input.text) }),
        });
        return r.json;
      },
    },
  },
};

const discord: Connector = {
  id: "discord",
  name: "Discord",
  description: "Send channel messages and simple embeds through an incoming webhook.",
  category: "messaging",
  authType: "token",
  fields: [
    {
      key: "webhookUrl",
      label: "Webhook URL",
      type: "password",
      required: true,
      help: "Discord channel settings → Integrations → Webhooks. Connection testing validates URL format only; delivery is checked when sending.",
    },
  ],
  async test(config) {
    try {
      discordWebhookUrl(config);
      return { ok: true, meta: { validation: "URL format only" } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  actions: {
    send_message: {
      effect: "write",
      description: "Send a message to the webhook's channel or a thread.",
      inputSchema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "Message text. Over 2000 characters is truncated with a final ellipsis within the limit.",
          },
          username: { type: "string", description: "Optional webhook display name." },
          threadId: { type: "string", description: "Optional thread ID in the webhook's channel." },
        },
        required: ["content"],
      },
      run: discordSendMessage,
    },
    send_embed: {
      effect: "write",
      description: "Send one simple Discord embed.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          url: { type: "string" },
          color: {
            type: "integer",
            minimum: 0,
            maximum: 16777215,
            description: "RGB color as a decimal integer.",
          },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                value: { type: "string" },
                inline: { type: "boolean" },
              },
              required: ["name", "value"],
            },
          },
        },
        required: ["title", "description"],
      },
      run: discordSendEmbed,
    },
  },
};

const telegram: Connector = {
  id: "telegram",
  name: "Telegram",
  description: "Send messages to chats and groups through a Telegram bot.",
  category: "messaging",
  authType: "token",
  fields: [
    {
      key: "botToken",
      label: "Bot token",
      type: "password",
      required: true,
      help: "Create a bot with BotFather. Connection testing checks the token, not chat access.",
    },
    {
      key: "defaultChatId",
      label: "Default chat ID",
      type: "text",
      required: true,
      help: "Chat or group ID used when an action does not specify chatId.",
    },
  ],
  async test(config) {
    try {
      await telegramTest(config);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  actions: {
    send_message: {
      effect: "write",
      description: "Send a bot message to a chat or group.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description:
              "Message text. Over 4096 characters is truncated with a final ellipsis within the limit. With formatting, keep markup valid at the truncation boundary.",
          },
          chatId: { type: "string", description: "Defaults to the configured defaultChatId." },
          parseMode: {
            type: "string",
            enum: ["MarkdownV2", "HTML", "none"],
            description: "Omit or use none for plain text.",
          },
          disableNotification: { type: "boolean" },
        },
        required: ["text"],
      },
      run: telegramSendMessage,
    },
  },
};

const TICKET_FIELDS = [
  "id",
  "name",
  "description",
  "priority",
  "stage_id",
  "team_id",
  "partner_id",
  "user_id",
  "tag_ids",
  "create_date",
  "write_date",
];

// `project.task` is a different model from `helpdesk.ticket`, with different
// columns: no team_id, and the assignees are `user_ids` (many) rather than
// `user_id`. Asking for a field a model does not have makes Odoo fail the whole
// read, so these lists cannot be shared.
const TASK_FIELDS = [
  "id",
  "name",
  "description",
  "priority",
  "stage_id",
  "project_id",
  // A support ticket is often a subtask of a parent that groups the same
  // complaint across customers, and that parent's description is often empty.
  // Without these an agent reads an empty task and stops there.
  "parent_id",
  "child_ids",
  "user_ids",
  "partner_id",
  "tag_ids",
  "date_deadline",
  // Done cards are archived: `active` tells a reader which of the results is.
  "active",
  // Odoo has no dedicated close timestamp on a task (`date_end` is a manual
  // planning field). The last stage change is the closest honest signal of
  // when a card reached Done, and it is what `closed_since` filters on.
  "date_last_stage_update",
  "create_date",
  "write_date",
];

// A note on a task is a `mail.message` row. `body` is HTML.
// Bounds for `get_case`: one call must stay small enough to read in full.
const CASE_MAX_CHILDREN = 20;
const CASE_MAX_SIBLINGS = 20;
const CASE_DEFAULT_NOTES_PER_TASK = 5;
const CASE_MAX_NOTES_PER_TASK = 20;
const CASE_NOTE_CHARS = 1500;
const CASE_DESCRIPTION_CHARS = 4000;

const MESSAGE_FIELDS = ["id", "date", "author_id", "message_type", "subtype_id", "body"];

// `execute` runs with the integration user's credentials, which in practice are
// an admin's. Left open it is a write primitive for the whole database, so it
// is limited to the model/method pairs the production flows actually use.
// Anything else needs its own typed action, reviewed on its own.
const EXECUTE_ALLOWLIST: Record<string, readonly string[]> = {
  "project.task": ["search_read", "read", "search_count", "create", "write", "message_post"],
  "mail.message": ["search_read", "read"],
};

// Identity fields only. A partner row carries addresses, phones and banking
// data that an incident analysis has no use for, so the read is explicit.
const PARTNER_FIELDS = ["id", "name", "vat", "is_company", "parent_id", "email", "country_id"];

// Metadata only: `datas` is the base64 file body. Tool results reach the model
// as text, so the contents would be noise at best and a token bomb at worst.
const ATTACHMENT_FIELDS = ["id", "name", "mimetype", "file_size", "create_date"];

/**
 * A page URI from the browser agent can carry credentials, tokens in the query
 * and personal data in the path. Keep only origin and path: drop userinfo,
 * query and fragment, decode and mask each segment, and replace opaque ids.
 */
function sanitizeUri(raw: string): string {
  const head = raw.slice(0, 2000).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/]*@/i, "$1");
  const cut = head.search(/[?#]/);
  const noQuery = cut === -1 ? head : head.slice(0, cut);
  const prefix = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(noQuery)?.[0] ?? "";
  const path = noQuery.slice(prefix.length);
  const OPAQUE =
    /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=.*\d)[A-Za-z0-9_+=-]{16,})$/i;
  const segments = path.split("/").map((seg) => {
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      /* keep the raw segment */
    }
    return OPAQUE.test(decoded) ? "[id]" : maskSensitive(decoded);
  });
  return (prefix + segments.join("/")).slice(0, 300);
}

function ticketValues(input: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (typeof input.name === "string") values.name = input.name;

  // `description` is HTML in Odoo. `description_text` is the escape hatch for
  // agent-written plain text, which would otherwise lose every line break and
  // get truncated at the first `<` of a stack trace.
  if (typeof input.description === "string") values.description = input.description;
  else if (typeof input.description_text === "string")
    values.description = htmlFromText(input.description_text);

  if (input.priority !== undefined) {
    const mapped = TICKET_PRIORITY[input.priority as TicketPriority];
    if (!mapped) {
      throw new Error(
        `Unknown priority "${String(input.priority)}". Use low, medium, high or urgent.`
      );
    }
    values.priority = mapped;
  }

  if (input.team_id !== undefined) values.team_id = Number(input.team_id);
  if (input.partner_id !== undefined) values.partner_id = Number(input.partner_id);
  if (input.stage_id !== undefined) values.stage_id = Number(input.stage_id);
  if (Array.isArray(input.tag_ids) && input.tag_ids.length > 0) {
    values.tag_ids = x2manyReplace(input.tag_ids.map(Number));
  }
  return values;
}

const odoo: Connector = {
  id: "odoo",
  name: "Odoo",
  description:
    "Helpdesk tickets, project tasks and any other Odoo model, over JSON-RPC. Agents can create and update tickets.",
  category: "productivity",
  authType: "token",
  fields: [
    {
      key: "baseUrl",
      label: "Odoo URL",
      type: "url",
      placeholder: "https://company.odoo.com",
      required: true,
    },
    {
      key: "db",
      label: "Database",
      type: "text",
      placeholder: "company",
      required: true,
      help: "On Odoo Online this is usually the subdomain.",
    },
    {
      key: "login",
      label: "User",
      type: "text",
      placeholder: "bot@company.com",
      required: true,
      help: "The ticket is created as this user. A dedicated bot account keeps the audit trail readable.",
    },
    {
      key: "apiKey",
      label: "API key",
      type: "password",
      placeholder: "Settings > Account Security > New API Key",
      required: true,
    },
  ],
  async test(config) {
    try {
      const uid = await odooAuthenticate(config);
      return { ok: true, meta: { uid } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  actions: {
    create_ticket: {
      effect: "write",
      description:
        "Create a helpdesk ticket. Use description_text for plain text (it is escaped and line breaks preserved) or description for HTML you already built.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Ticket title — one line." },
          description_text: { type: "string", description: "Body as plain text." },
          description: { type: "string", description: "Body as HTML. Overrides description_text." },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "urgent"],
            description: "Defaults to Odoo's own default when omitted.",
          },
          team_id: { type: "number", description: "Helpdesk team id." },
          partner_id: { type: "number", description: "Customer (res.partner) id." },
          tag_ids: {
            type: "array",
            items: { type: "number" },
            description: "Tag ids. Sent as an x2many replace command.",
          },
        },
        required: ["name"],
      },
      async run(config, input) {
        const values = ticketValues(input);
        if (!values.name) throw new Error("A ticket needs a name.");
        const ticketId = await odooExecute(config, "helpdesk.ticket", "create", [values]);
        return { ok: true, ticket_id: ticketId };
      },
    },

    update_ticket: {
      effect: "write",
      description: "Update fields on an existing helpdesk ticket.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "number" },
          name: { type: "string" },
          description_text: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          stage_id: { type: "number" },
          team_id: { type: "number" },
          tag_ids: { type: "array", items: { type: "number" } },
        },
        required: ["id"],
      },
      async run(config, input) {
        const values = ticketValues(input);
        if (Object.keys(values).length === 0) throw new Error("Nothing to update.");
        const ok = await odooExecute(config, "helpdesk.ticket", "write", [
          [Number(input.id)],
          values,
        ]);
        return { ok: Boolean(ok), ticket_id: Number(input.id) };
      },
    },

    get_ticket: {
      effect: "read",
      description: "Read one helpdesk ticket by id.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
      },
      async run(config, input) {
        const rows = (await odooExecute(config, "helpdesk.ticket", "read", [[Number(input.id)]], {
          fields: TICKET_FIELDS,
        })) as unknown[];
        return { ticket: rows?.[0] ?? null };
      },
    },

    search_tickets: {
      effect: "read",
      description:
        "Search helpdesk tickets by title substring. Use it before creating a ticket to avoid filing a duplicate.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Matched against the ticket title." },
          limit: { type: "number", description: "Max rows, capped at 100. Defaults to 20." },
        },
      },
      async run(config, input) {
        const domain: unknown[] = [];
        if (typeof input.query === "string" && input.query.trim()) {
          domain.push(["name", "ilike", input.query.trim()]);
        }
        const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 100);
        const tickets = await odooExecute(config, "helpdesk.ticket", "search_read", [domain], {
          fields: TICKET_FIELDS,
          limit,
        });
        return { tickets };
      },
    },

    // ── project.task ────────────────────────────────────────────────────────
    // Helpdesk tickets and project tasks are different models, and the three
    // actions above only ever touch `helpdesk.ticket`. An agent that works on
    // tasks had `execute` as its only route — which can call any method on any
    // model, so a read of one project became a write primitive for the whole
    // database. These three cover what reading a task actually needs.

    get_task: {
      effect: "read",
      // `read` by id does not apply Odoo's active_test, so an archived (Done)
      // task is returned without any context override.
      description: "Read one project task by id.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
      },
      async run(config, input) {
        const rows = (await odooExecute(config, "project.task", "read", [[Number(input.id)]], {
          fields: TASK_FIELDS,
        })) as unknown[];
        return { task: rows?.[0] ?? null };
      },
    },

    search_tasks: {
      effect: "read",
      description:
        "Search project tasks. Narrow with project_id, stage_id, parent_id or a title substring. Returns the task fields, not its notes — use get_task_notes for those.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Matched against the task title." },
          description_query: { type: "string", description: "Matched against the task body." },
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
              "Restrict to any of these stages. Stage names change with the user's language, so key on ids (see list_stages).",
          },
          parent_id: { type: "number", description: "Only the subtasks of this task." },
          created_since: {
            type: "string",
            description:
              "ISO 8601. Compared against create_date, which Odoo stores in UTC — pass UTC or the window silently shifts.",
          },
          closed_since: {
            type: "string",
            description:
              "ISO 8601, UTC. Tasks whose last stage change (date_last_stage_update) is at or after this instant. Combine with stage_ids of the Done stage and include_archived to list recent closures.",
          },
          name_prefix: {
            type: "string",
            description:
              "Catalogue code the title starts with, e.g. '1.2.28'. Matched at the start of the title only; % and _ are literal.",
          },
          include_archived: {
            type: "boolean",
            description:
              "Also search archived tasks. Done cards are archived, so without this the history of a recurring issue is invisible. Defaults to false.",
          },
          limit: { type: "number", description: "Max rows, capped at 100. Defaults to 20." },
        },
      },
      async run(config, input) {
        const domain: unknown[] = [];
        if (typeof input.query === "string" && input.query.trim()) {
          domain.push(["name", "ilike", input.query.trim()]);
        }
        if (typeof input.description_query === "string" && input.description_query.trim()) {
          // The same complaint is often filed per customer; the title varies
          // but the body repeats, so the body is the better key to find siblings.
          domain.push(["description", "ilike", input.description_query.trim()]);
        }
        if (input.project_id != null) domain.push(["project_id", "=", Number(input.project_id)]);
        if (Array.isArray(input.project_ids) && input.project_ids.length > 0) {
          domain.push(["project_id", "in", input.project_ids.map(Number)]);
        }
        if (input.tag_id != null) domain.push(["tag_ids", "in", [Number(input.tag_id)]]);
        // Tasks have many assignees (`user_ids`), so `=` would never match.
        if (input.user_id != null) domain.push(["user_ids", "in", [Number(input.user_id)]]);
        if (input.stage_id != null) domain.push(["stage_id", "=", Number(input.stage_id)]);
        if (Array.isArray(input.stage_ids) && input.stage_ids.length > 0) {
          domain.push(["stage_id", "in", input.stage_ids.map(Number)]);
        }
        if (input.parent_id != null) domain.push(["parent_id", "=", Number(input.parent_id)]);
        if (typeof input.name_prefix === "string" && input.name_prefix.trim()) {
          // `=ilike` is a LIKE pattern: a code such as "1.2_8" must not treat
          // `_` or `%` as wildcards. Backslash is Odoo's LIKE escape.
          const escaped = input.name_prefix.trim().replace(/[\\%_]/g, "\\$&");
          domain.push(["name", "=ilike", `${escaped}%`]);
        }
        if (typeof input.closed_since === "string" && input.closed_since.trim()) {
          const d = new Date(input.closed_since.trim());
          if (Number.isNaN(d.getTime()))
            throw new Error(`closed_since is not a date: ${input.closed_since}`);
          domain.push([
            "date_last_stage_update",
            ">=",
            d.toISOString().slice(0, 19).replace("T", " "),
          ]);
        }
        if (typeof input.created_since === "string" && input.created_since.trim()) {
          // Odoo rejects the `T` and the trailing `Z` of an ISO timestamp, so
          // the value is reshaped rather than passed through. A bad date here
          // does not error: it silently matches nothing.
          const d = new Date(input.created_since.trim());
          if (Number.isNaN(d.getTime()))
            throw new Error(`created_since is not a date: ${input.created_since}`);
          domain.push(["create_date", ">=", d.toISOString().slice(0, 19).replace("T", " ")]);
        }
        const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 100);
        const tasks = await odooExecute(config, "project.task", "search_read", [domain], {
          fields: TASK_FIELDS,
          limit,
          order: "create_date desc",
          // `=== true`: a string "false" from a sloppy caller must not widen the search.
          ...(input.include_archived === true && { context: { active_test: false } }),
        });
        return { tasks };
      },
    },

    get_case: {
      effect: "read",
      description:
        "Read a whole bug case in one call: the task, its parent, its subtasks, its siblings, the latest notes of the task and of each subtask, and attachment counts per task (never file contents).",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "number", description: "Task id." },
          notes_per_task: {
            type: "number",
            description: `Latest notes kept per task, capped at ${CASE_MAX_NOTES_PER_TASK}. Defaults to ${CASE_DEFAULT_NOTES_PER_TASK}.`,
          },
        },
        required: ["id"],
      },
      async run(config, input) {
        const id = Number(input.id);
        const notesPerTask = Math.min(
          Math.max(Math.trunc(Number(input.notes_per_task ?? CASE_DEFAULT_NOTES_PER_TASK)) || 1, 1),
          CASE_MAX_NOTES_PER_TASK
        );
        const archived = { context: { active_test: false } };
        type Row = Record<string, unknown> & { id: number };
        const idList = (v: unknown): number[] =>
          Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];
        const many = (v: unknown): number | null =>
          Array.isArray(v) && typeof v[0] === "number" ? v[0] : null;
        const withText = (r: Row): Row => ({
          ...r,
          description: htmlToText(r.description, CASE_DESCRIPTION_CHARS),
        });
        const summary = (r: Row) => ({
          id: r.id,
          name: r.name,
          stage_id: r.stage_id,
          project_id: r.project_id,
          priority: r.priority,
          create_date: r.create_date,
          write_date: r.write_date,
        });

        // `read` ignores active_test, so an archived task comes back as is.
        const taskRows = (await odooExecute(config, "project.task", "read", [[id]], {
          fields: TASK_FIELDS,
        })) as Row[];
        const task = taskRows?.[0];
        if (!task) {
          return {
            task: null,
            parent: null,
            children: [],
            siblings: [],
            notes: {},
            attachments: {},
          };
        }
        const parentId = many(task.parent_id);
        const allChildIds = idList(task.child_ids);
        const childIds = allChildIds.slice(0, CASE_MAX_CHILDREN);

        // Parent and children in ONE read. The ids are bounded above, so the
        // limit never truncates; archived rows are included on purpose, since
        // Done cards are archived.
        const batchIds: unknown[] = [];
        if (childIds.length > 0) batchIds.push(["id", "in", childIds]);
        if (parentId != null) batchIds.push(["id", "=", parentId]);
        let parentRow: Row | undefined;
        let children: Row[] = [];
        if (batchIds.length > 0) {
          const domain = batchIds.length === 2 ? ["|", ...batchIds] : batchIds;
          const rows = (await odooExecute(config, "project.task", "search_read", [domain], {
            fields: TASK_FIELDS,
            limit: childIds.length + 1,
            order: "id asc",
            ...archived,
          })) as Row[];
          parentRow = rows.find((r) => r.id === parentId);
          children = rows.filter((r) => r.id !== parentId).slice(0, CASE_MAX_CHILDREN);
        }

        let siblings: Row[] = [];
        if (parentId != null) {
          siblings = (await odooExecute(
            config,
            "project.task",
            "search_read",
            [
              [
                ["parent_id", "=", parentId],
                ["id", "!=", id],
              ],
            ],
            {
              fields: TASK_FIELDS,
              limit: CASE_MAX_SIBLINGS,
              order: "id asc",
              ...archived,
            }
          )) as Row[];
        }

        const caseIds = [id, ...children.map((c) => c.id)];
        // Chatter: tracking rows are `notification`; the notes a person or the
        // pipeline wrote are `comment` or `email`. One read per task (the task
        // and its children; siblings get none), each with its own quota, so a
        // busy task cannot crowd the notes of a quiet one out of a shared
        // newest-first window. One extra row per task tells us whether its
        // quota was hit.
        const notes: Record<string, unknown[]> = {};
        const notesTruncated: Record<string, boolean> = {};
        const perTask = await Promise.all(
          caseIds.map(
            (taskId) =>
              odooExecute(
                config,
                "mail.message",
                "search_read",
                [
                  [
                    ["model", "=", "project.task"],
                    ["res_id", "=", taskId],
                    ["message_type", "in", ["comment", "email"]],
                  ],
                ],
                {
                  fields: [...MESSAGE_FIELDS, "res_id"],
                  limit: notesPerTask + 1,
                  order: "date desc, id desc",
                }
              ) as Promise<Row[]>
          )
        );
        caseIds.forEach((taskId, i) => {
          const own = perTask[i]!.filter((m) => m.res_id === taskId);
          notesTruncated[String(taskId)] = own.length > notesPerTask;
          notes[String(taskId)] = own.slice(0, notesPerTask).map((m) => {
            const { res_id: _resId, ...rest } = m;
            void _resId;
            return { ...rest, body: htmlToText(m.body, CASE_NOTE_CHARS) };
          });
        });

        // Metadata only: `datas` is the file body and is never requested.
        const files = (await odooExecute(
          config,
          "ir.attachment",
          "search_read",
          [
            [
              ["res_model", "=", "project.task"],
              ["res_id", "in", caseIds],
            ],
          ],
          { fields: ["id", "res_id", "mimetype", "file_size"], limit: 500 }
        )) as Array<{ res_id: number; mimetype?: string }>;
        const attachments: Record<string, { count: number; images: number }> = {};
        for (const f of files) {
          const a = (attachments[String(f.res_id)] ??= { count: 0, images: 0 });
          a.count++;
          if (f.mimetype?.startsWith("image/")) a.images++;
        }

        return {
          task: withText(task),
          parent: parentRow ? summary(parentRow) : null,
          children: children.map(withText),
          childrenTotal: allChildIds.length,
          siblings: siblings.map(summary),
          notes,
          notesTruncated,
          attachments,
        };
      },
    },

    get_task_notes: {
      effect: "read",
      description:
        "The notes posted on a project task, newest first. This is where the pipeline leaves its evidence, so it is where an analysis of an incident starts.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "number", description: "Task id." },
          limit: { type: "number", description: "Max notes, capped at 100. Defaults to 20." },
          exclude_tracking: {
            type: "boolean",
            description:
              "Keep only human-written messages (comment, email) and drop field-change tracking and system notifications, which otherwise drown the notes. Defaults to false here so existing flows keep their behaviour; the agent tool defaults it to true.",
          },
          subtype: {
            type: ["number", "string"],
            description:
              "Only messages of this subtype: a subtype id (stable) or its display name (translated with the user's language, so prefer the id).",
          },
        },
        required: ["id"],
      },
      async run(config, input) {
        const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 100);
        const domain: unknown[] = [
          ["model", "=", "project.task"],
          ["res_id", "=", Number(input.id)],
        ];
        // `=== true`: a string "false" must not switch the filter on.
        if (input.exclude_tracking === true) {
          domain.push(["message_type", "in", ["comment", "email"]]);
        }
        if (typeof input.subtype === "number") {
          domain.push(["subtype_id", "=", input.subtype]);
        } else if (typeof input.subtype === "string" && input.subtype.trim()) {
          domain.push(["subtype_id.name", "=", input.subtype.trim()]);
        }
        const notes = await odooExecute(config, "mail.message", "search_read", [domain], {
          fields: MESSAGE_FIELDS,
          limit,
          order: "date desc",
        });
        return { notes };
      },
    },

    get_task_attachments: {
      effect: "read",
      description:
        "List all task attachment metadata. Set include_images=true to inspect screenshot evidence (newest PNG/JPEG/GIF/WebP images, 1 MB each, up to max_images, default four; images under 10 KB are listed but not shown). Set include_case=true to cover the task, its parent and its subtasks, each row tagged with its task_id.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "number", description: "Task id." },
          include_images: { type: "boolean", default: false },
          include_case: {
            type: "boolean",
            default: false,
            description:
              "Also read the attachments of the parent task and the subtasks (the same ids odoo get_case uses). Each row carries task_id.",
          },
          max_images: {
            type: "number",
            description: "Images returned when include_images is true, 1 to 8. Defaults to 4.",
          },
        },
        required: ["id"],
      },
      async run(config, input) {
        const id = Number(input.id);
        let taskIds = [id];
        const withCase = input.include_case === true;
        if (withCase) {
          const rows = (await odooExecute(config, "project.task", "read", [[id]], {
            fields: ["id", "parent_id", "child_ids"],
          })) as Array<{ parent_id?: unknown; child_ids?: unknown }>;
          const t = rows?.[0];
          const parent =
            Array.isArray(t?.parent_id) && typeof t.parent_id[0] === "number"
              ? [t.parent_id[0]]
              : [];
          const kids = Array.isArray(t?.child_ids)
            ? t.child_ids
                .filter((n): n is number => typeof n === "number")
                .slice(0, CASE_MAX_CHILDREN)
            : [];
          taskIds = [...new Set([id, ...parent, ...kids])];
        }
        const found = (await odooExecute(
          config,
          "ir.attachment",
          "search_read",
          [
            [
              ["res_model", "=", "project.task"],
              withCase ? ["res_id", "in", taskIds] : ["res_id", "=", id],
            ],
          ],
          {
            fields: withCase ? [...ATTACHMENT_FIELDS, "res_id"] : ATTACHMENT_FIELDS,
            order: "create_date desc, id desc",
            ...(withCase ? { limit: 500 } : {}),
          }
        )) as Array<{
          id: number;
          name: string;
          mimetype: string;
          file_size: number;
          res_id?: number;
        }>;
        const attachments = withCase
          ? found.map(({ res_id, ...rest }) => ({ ...rest, task_id: res_id }))
          : found;
        if (input.include_images !== true) return { attachments };
        const maxRaw = Math.trunc(Number(input.max_images));
        const maxImages = Number.isFinite(maxRaw)
          ? Math.min(Math.max(maxRaw, 1), MAX_TOOL_IMAGES_HARD)
          : MAX_TOOL_IMAGES;
        const selected: Array<(typeof attachments)[number]> = [];
        const notes: string[] = [];
        for (const attachment of attachments as Array<(typeof attachments)[number]>) {
          if (!attachment.mimetype?.startsWith("image/")) continue;
          let reason: string | undefined;
          if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(attachment.mimetype))
            reason = "unsupported MIME type";
          else if (attachment.file_size > MAX_TOOL_IMAGE_BYTES) reason = "exceeds 1 MB";
          else if (attachment.file_size < MIN_TOOL_IMAGE_BYTES) reason = "under 10 KB";
          else if (selected.length >= maxImages) reason = `limit of ${maxImages} images`;
          if (reason) notes.push(`[image omitted: ${attachment.name}, ${reason}]`);
          else selected.push(attachment);
        }
        const data = selected.length
          ? ((await odooExecute(config, "ir.attachment", "read", [selected.map((a) => a.id)], {
              fields: ["id", "datas"],
            })) as Array<{ id: number; datas: string | false }>)
          : [];
        return normalizeToolOutput({
          maxImages,
          text: [JSON.stringify({ attachments }), ...notes].join("\n"),
          images: selected.map((a) => ({
            name: a.name,
            mediaType: a.mimetype,
            base64: data.find((d) => d.id === a.id)?.datas ?? "",
          })),
        });
      },
    },

    get_attachment_table: {
      effect: "read",
      description:
        "Read a CSV or XLSX attachment of a project task as a table: sheet name, columns and the first 50 rows. Content is untrusted; long digit runs and e-mail addresses are masked.",
      inputSchema: {
        type: "object",
        properties: {
          attachment_id: {
            type: "number",
            description: "Attachment id (from get_task_attachments).",
          },
          task_id: {
            type: "number",
            description: "Optional guard: refuse unless the attachment belongs to this task.",
          },
        },
        required: ["attachment_id"],
      },
      async run(config, input) {
        const attachmentId = Number(input.attachment_id);
        if (!Number.isInteger(attachmentId) || attachmentId <= 0)
          throw new Error("get_attachment_table needs a positive integer attachment_id.");
        const hasTask = input.task_id !== undefined && input.task_id !== null;
        const taskId = hasTask ? Number(input.task_id) : null;
        if (hasTask && (!Number.isInteger(taskId) || taskId! <= 0))
          throw new Error("task_id must be a positive integer.");
        const rows = (await odooExecute(config, "ir.attachment", "read", [[attachmentId]], {
          fields: ["id", "name", "mimetype", "file_size", "res_model", "res_id"],
        })) as Array<{
          id: number;
          name?: string;
          mimetype?: string;
          file_size?: number;
          res_model?: string | false;
          res_id?: number;
        }>;
        const meta = rows?.[0];
        if (!meta) throw new Error(`Attachment ${attachmentId} not found.`);
        if (meta.res_model !== "project.task")
          throw new Error("The attachment does not belong to a project.task.");
        if (taskId !== null && meta.res_id !== taskId)
          throw new Error(`The attachment does not belong to task ${taskId}.`);
        const name = String(meta.name ?? "");
        const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase();
        const mime = String(meta.mimetype ?? "").toLowerCase();
        const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        let kind: "csv" | "xlsx";
        if (
          ext === "csv" ||
          (ext === undefined && (mime === "text/csv" || mime === "application/csv"))
        )
          kind = "csv";
        else if (ext === "xlsx" || mime === XLSX_MIME) kind = "xlsx";
        else if (ext === "xls" || mime === "application/vnd.ms-excel")
          throw new Error("Unsupported format: legacy .xls. Ask for the file as xlsx or csv.");
        else if (mime === "text/csv" || mime === "application/csv") kind = "csv";
        else throw new Error("Unsupported format: only csv and xlsx attachments can be read.");
        if (!(Number(meta.file_size) <= MAX_TABLE_FILE_BYTES))
          throw new Error("The attachment is larger than 5 MB.");
        const data = (await odooExecute(config, "ir.attachment", "read", [[attachmentId]], {
          fields: ["id", "datas"],
        })) as Array<{ datas?: string | false }>;
        const b64 = data?.[0]?.datas;
        if (!b64) throw new Error("The attachment has no content.");
        if (b64.length > Math.ceil((MAX_TABLE_FILE_BYTES * 4) / 3) + 8)
          throw new Error("The attachment is larger than 5 MB.");
        const buf = Buffer.from(b64, "base64");
        if (buf.length > MAX_TABLE_FILE_BYTES)
          throw new Error("The attachment is larger than 5 MB.");
        const table = kind === "csv" ? tableFromCsv(buf) : readXlsx(buf);
        return {
          attachment_id: attachmentId,
          name: maskSensitive(name),
          ...("sheet" in table ? {} : { sheet: null }),
          ...table,
        };
      },
    },

    get_partner: {
      effect: "read",
      description: "Read one customer (res.partner) by id: identity fields only.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
      },
      async run(config, input) {
        const rows = (await odooExecute(config, "res.partner", "read", [[Number(input.id)]], {
          fields: PARTNER_FIELDS,
        })) as unknown[];
        return { partner: rows?.[0] ?? null };
      },
    },

    list_stages: {
      effect: "read",
      description: "List the stages of a project, in board order.",
      inputSchema: {
        type: "object",
        properties: { project_id: { type: "number" } },
        required: ["project_id"],
      },
      async run(config, input) {
        if (input.project_id == null) throw new Error("list_stages needs a project_id.");
        const stages = await odooExecute(
          config,
          "project.task.type",
          "search_read",
          [[["project_ids", "in", [Number(input.project_id)]]]],
          { fields: ["id", "name", "sequence", "fold"], order: "sequence" }
        );
        return { stages };
      },
    },

    post_note: {
      effect: "write",
      description:
        "Post an INTERNAL note on a ticket or task. Internal means the customer never sees it — use it for the full technical report.",
      inputSchema: {
        type: "object",
        properties: {
          model: {
            type: "string",
            description: "helpdesk.ticket or project.task. Defaults to helpdesk.ticket.",
          },
          id: { type: "number" },
          body_markdown: {
            type: "string",
            description:
              "Note as Markdown (preferred): paragraphs, # headings, **bold**, *italic*, `code`, lists, [text](https://url), ---. Rendered to safe HTML; raw HTML in it is shown as text. Overrides body_text.",
          },
          body_text: { type: "string", description: "Note as plain text." },
          body: {
            type: "string",
            description: "Note as raw HTML, posted as is. Overrides body_markdown and body_text.",
          },
          marker: {
            type: "string",
            description:
              "Idempotency key (letters, digits, . _ : -, up to 100). The note starts with a visible line [[orchester:<marker>]]; if a message on this record already carries it, nothing is posted and { posted: false, reason: 'duplicate' } is returned.",
          },
        },
        required: ["id"],
      },
      async run(config, input) {
        const model = String(input.model ?? "helpdesk.ticket");
        // Precedence: body (raw HTML) > body_markdown > body_text.
        let body =
          typeof input.body === "string"
            ? input.body
            : typeof input.body_markdown === "string"
              ? markdownToHtml(input.body_markdown)
              : htmlFromText(String(input.body_text ?? ""));
        if (!body.trim()) throw new Error("A note needs a body.");
        if (input.marker != null) {
          // The marker is plain text on purpose: Odoo's HTML sanitiser strips
          // comments and unknown attributes, so a hidden carrier would not
          // survive the round trip and the duplicate check would never match.
          const marker = String(input.marker);
          if (!/^[A-Za-z0-9._:-]{1,100}$/.test(marker)) {
            throw new Error("post_note: marker may only use letters, digits, . _ : - (max 100).");
          }
          const tag = `[[orchester:${marker}]]`;
          // Candidates come from a loose substring query (`=ilike` leaves the
          // wildcards to us, so `_`, `%` and `\` in the marker are escaped and
          // stay literal). Only internal notes count: the message type and
          // subtype are what `post_note` itself creates, so a customer email
          // quoting the marker can never suppress a report. The author is not
          // checked: the connector has no cheap way to know its own partner id
          // (it would cost a res.users read on every call), and the internal
          // note restriction already excludes everything a customer can send.
          const pattern = `%${tag.replace(/[\\%_]/g, "\\$&")}%`;
          const candidates = (await odooExecute(
            config,
            "mail.message",
            "search_read",
            [
              [
                ["model", "=", model],
                ["res_id", "=", Number(input.id)],
                ["message_type", "=", "comment"],
                ["subtype_id.internal", "=", true],
                ["body", "=ilike", pattern],
              ],
            ],
            { fields: ["id", "body", "message_type", "subtype_id"], limit: 50 }
          )) as { body?: unknown; message_type?: unknown; subtype_id?: unknown }[];
          // Exact, case-sensitive match of the whole marker line.
          const duplicate = candidates.some(
            (m) =>
              m.message_type === "comment" &&
              Boolean(m.subtype_id) &&
              htmlToText(m.body, 100_000)
                .split("\n")
                .some((line) => line.trim() === tag)
          );
          if (duplicate) return { posted: false, reason: "duplicate" };
          body = `<p>${tag}</p>${body}`;
        }
        // Known, accepted race: the marker lookup and this post are separate
        // Odoo calls, so two concurrent requests with the same marker can both
        // see "absent" and both post. Closing it needs an Odoo-side method that
        // checks and posts atomically; for now the duplicate is an extra
        // internal note, never customer-visible, and sequential retries are
        // already deduplicated.
        const messageId = await odooExecute(config, model, "message_post", [[Number(input.id)]], {
          body,
          // `body` is always HTML here (input.body, body_markdown rendered by
          // markdownToHtml, or body_text escaped by htmlFromText). Over RPC, Odoo 17+ escapes a body it is not told is
          // HTML, and the note shows literal <br/> tags.
          body_is_html: true,
          message_type: "comment",
          // Without mt_note the message goes out to the customer as an email.
          subtype_xmlid: "mail.mt_note",
        });
        return { ok: true, message_id: messageId };
      },
    },

    move_task: {
      effect: "write",
      description:
        'Move a project task to another stage, narrowly. Moves only if the task is still in from_stage_id (a card a person already moved is left alone and { moved: false, reason: "not_in_expected_stage", current_stage_id } is returned) and only to a stage of the task\'s own project (otherwise it throws). Writes stage_id and nothing else. Meant for flow steps; agents do not get it as a tool.',
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number" },
          from_stage_id: { type: "number", description: "Stage the task must currently be in." },
          to_stage_id: { type: "number", description: "Destination stage, same project." },
        },
        required: ["task_id", "from_stage_id", "to_stage_id"],
      },
      async run(config, input) {
        if (input.task_id == null) throw new Error("move_task needs a task_id.");
        if (input.from_stage_id == null) throw new Error("move_task needs a from_stage_id.");
        if (input.to_stage_id == null) throw new Error("move_task needs a to_stage_id.");
        const taskId = Number(input.task_id);
        const fromStage = Number(input.from_stage_id);
        const toStage = Number(input.to_stage_id);

        const tasks = (await odooExecute(config, "project.task", "read", [[taskId]], {
          fields: ["id", "project_id", "stage_id"],
        })) as { project_id: [number, string] | false; stage_id: [number, string] | false }[];
        const task = tasks[0];
        if (!task) throw new Error(`move_task: task ${taskId} not found.`);

        const currentStage = task.stage_id ? task.stage_id[0] : null;
        if (currentStage !== fromStage) {
          return { moved: false, reason: "not_in_expected_stage", current_stage_id: currentStage };
        }

        const stages = (await odooExecute(config, "project.task.type", "read", [[toStage]], {
          fields: ["id", "project_ids"],
        })) as { project_ids: number[] }[];
        const projectId = task.project_id ? task.project_id[0] : null;
        if (projectId == null || !stages[0]?.project_ids.includes(projectId)) {
          throw new Error(`move_task: stage ${toStage} does not belong to the task's project.`);
        }

        // Known, accepted race: the stage check above and this write are two
        // separate Odoo calls, so a person who moves the card between them is
        // overwritten. Closing it needs a server-side compare-and-set method in
        // Odoo (JSON-RPC offers no conditional write); until that exists the
        // window is a few hundred milliseconds and the worst case is a card
        // landing in the stage the flow intended.
        await odooExecute(config, "project.task", "write", [[taskId], { stage_id: toStage }]);
        return { moved: true, task_id: taskId, from_stage_id: fromStage, to_stage_id: toStage };
      },
    },

    set_task_tags: {
      effect: "write",
      description:
        "Add and/or remove tags on ONE project task, restricted to tags whose name starts with 'ag:'. Any other tag makes the call fail before anything is written. Writes tag_ids and nothing else. Meant for flow steps; agents do not get it as a tool.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number" },
          add: { type: "array", items: { type: "number" }, description: "Tag ids to attach." },
          remove: { type: "array", items: { type: "number" }, description: "Tag ids to detach." },
        },
        required: ["task_id"],
      },
      async run(config, input) {
        if (input.task_id == null) throw new Error("set_task_tags needs a task_id.");
        const taskId = Number(input.task_id);
        const toIds = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number))] : []);
        const add = toIds(input.add);
        const remove = toIds(input.remove);
        if (add.length + remove.length === 0) {
          throw new Error("set_task_tags needs an add or remove list.");
        }
        const wanted = [...new Set([...add, ...remove])];
        // Read through odooExecute, not the `execute` allowlist: the allowlist
        // stays closed to project.tags.
        const rows = (await odooExecute(config, "project.tags", "read", [wanted], {
          fields: ["id", "name"],
        })) as { id: number; name: string | false }[];
        const names = new Map(rows.map((r) => [r.id, r.name]));
        for (const id of wanted) {
          const name = names.get(id);
          if (typeof name !== "string") throw new Error(`set_task_tags: tag ${id} not found.`);
          if (!name.startsWith("ag:")) {
            throw new Error(`set_task_tags: tag ${id} is not an 'ag:' tag; refusing.`);
          }
        }
        const commands = [...add.map((id) => [4, id, 0]), ...remove.map((id) => [3, id, 0])];
        await odooExecute(config, "project.task", "write", [[taskId], { tag_ids: commands }]);
        return { ok: true, task_id: taskId, added: add, removed: remove };
      },
    },

    execute: {
      effect: (input) => (ODOO_READ_METHODS.has(String(input.method)) ? "read" : "write"),
      effectKeys: ["method"],
      description:
        "Escape hatch — call any model method (execute_kw). Use only when no dedicated action fits.",
      inputSchema: {
        type: "object",
        properties: {
          model: { type: "string", description: "e.g. project.task" },
          method: { type: "string", description: "e.g. search_read, create, write" },
          args: { type: "array", items: {}, description: "Positional arguments." },
          kwargs: { type: "object", description: "Keyword arguments, e.g. fields or limit." },
        },
        required: ["model", "method"],
      },
      async run(config, input) {
        const model = String(input.model);
        const method = String(input.method);
        // Checked before any RPC, so a refused call costs no round trip and
        // leaves no trace in Odoo.
        if (!EXECUTE_ALLOWLIST[model]?.includes(method)) {
          throw new Error(`execute: ${model}.${method} is not allowed. Use a dedicated action.`);
        }
        const result = await odooExecute(
          config,
          model,
          method,
          Array.isArray(input.args) ? input.args : [],
          (input.kwargs as Record<string, unknown>) ?? {}
        );
        return { result };
      },
    },
  },
};

const newrelic: Connector = {
  id: "newrelic",
  name: "New Relic",
  description:
    "Query errors, logs and deployments over NerdGraph. Agents can pull the context an alert payload does not carry.",
  category: "data",
  authType: "token",
  fields: [
    {
      key: "accountId",
      label: "Account ID",
      type: "text",
      placeholder: "1234567",
      required: true,
    },
    {
      key: "apiKey",
      label: "User key",
      type: "password",
      placeholder: "NRAK-…",
      required: true,
      help: "A User key (NRAK-…), not the license key that feeds the APM agent — NerdGraph rejects the latter.",
    },
    {
      key: "endpoint",
      label: "Endpoint",
      type: "url",
      placeholder: "https://api.newrelic.com/graphql",
      required: false,
      help: "Only for EU accounts: https://api.eu.newrelic.com/graphql",
    },
  ],
  async test(config) {
    try {
      await nerdgraph(config, "{ actor { user { id } } }");
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // The most common setup mistake by far, and the API's own message never
      // names it.
      const hint = looksLikeUserKey(config.apiKey ?? "")
        ? ""
        : " — that key does not look like a User key (NRAK-…). The license key that feeds the APM agent does not work with NerdGraph.";
      return { ok: false, error: `${message}${hint}` };
    }
  },
  actions: {
    get_errors: {
      effect: "read",
      description:
        "Top errors for an application in a recent window, grouped by class and message.",
      inputSchema: {
        type: "object",
        properties: {
          app_name: { type: "string", description: "APM application name, e.g. user-service." },
          since_minutes: { type: "number", description: "Window in minutes. Max 1440." },
          limit: { type: "number", description: "Max rows. Max 100." },
        },
        required: ["app_name"],
      },
      async run(config, input) {
        const errors = await runNrql(
          config,
          buildErrorsQuery(
            String(input.app_name),
            Number(input.since_minutes ?? 30),
            Number(input.limit ?? 20)
          )
        );
        return { errors };
      },
    },

    get_logs_for_trace: {
      effect: "read",
      description:
        "Log lines for one distributed trace, oldest first. Use the trace_id carried by the alert payload.",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string" },
          limit: { type: "number", description: "Max rows. Max 100." },
        },
        required: ["trace_id"],
      },
      async run(config, input) {
        const logs = await runNrql(
          config,
          buildTraceLogsQuery(String(input.trace_id), Number(input.limit ?? 100))
        );
        return { logs };
      },
    },

    get_deployments: {
      effect: "read",
      description:
        "Recent deployments for an application. A spike that starts right after one is usually the rollout.",
      inputSchema: {
        type: "object",
        properties: {
          app_name: { type: "string" },
          limit: { type: "number" },
        },
        required: ["app_name"],
      },
      async run(config, input) {
        const deployments = await runNrql(
          config,
          buildDeploymentsQuery(String(input.app_name), Number(input.limit ?? 5))
        );
        return { deployments };
      },
    },

    get_browser_errors: {
      effect: "read",
      description:
        "Browser (JavaScript) errors for one Browser application, grouped by class and message, most frequent first. Fixed query on JavaScriptError; max 20 groups.",
      inputSchema: {
        type: "object",
        properties: {
          appName: {
            type: "string",
            description: "Browser application name as New Relic reports it.",
          },
          since_hours: {
            type: "integer",
            minimum: 1,
            maximum: 168,
            description: "Window in hours. Default 24.",
          },
          message_contains: {
            type: "string",
            maxLength: 120,
            description: "Substring of the error message. Cannot contain %.",
          },
          page_contains: {
            type: "string",
            maxLength: 120,
            description: "Substring of the page URI. Cannot contain %.",
          },
        },
        required: ["appName"],
      },
      async run(config, input) {
        const sinceHours = input.since_hours === undefined ? 24 : Number(input.since_hours);
        const query = buildBrowserErrorsQuery({
          appName: input.appName as string,
          sinceHours,
          messageContains: input.message_contains as string | undefined,
          pageContains: input.page_contains as string | undefined,
        });
        const rows = await runNrql(config, query);
        return {
          errors: rows.map((r) => ({
            error_class: String(r.errorClass ?? (r.facet as unknown[] | undefined)?.[0] ?? ""),
            message: maskSensitive(
              String(r.errorMessage ?? (r.facet as unknown[] | undefined)?.[1] ?? "")
            ).slice(0, 300),
            count: Number(r.count ?? 0),
            last_seen: r.last_seen ?? null,
            sample_uri: r.sample_uri == null ? null : sanitizeUri(String(r.sample_uri)),
          })),
          since_hours: sinceHours,
          truncated: rows.length >= BROWSER_ERRORS_LIMIT,
        };
      },
    },

    search_logs: {
      effect: "read",
      description:
        "Recent log lines for one service (filters service.name), newest first, health probes excluded. Fixed query on Log; messages are masked.",
      inputSchema: {
        type: "object",
        properties: {
          service: { type: "string", description: "Value of service.name." },
          since_minutes: {
            type: "integer",
            minimum: 5,
            maximum: 1440,
            description: "Window in minutes. Default 60.",
          },
          message_contains: {
            type: "string",
            maxLength: 120,
            description: "Substring of the message. Cannot contain %.",
          },
          level: { type: "string", enum: [...LOG_LEVELS] },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Max rows. Default 30.",
          },
        },
        required: ["service"],
      },
      async run(config, input) {
        const query = buildSearchLogsQuery({
          service: input.service as string,
          sinceMinutes: input.since_minutes as number | undefined,
          messageContains: input.message_contains as string | undefined,
          level: input.level as (typeof LOG_LEVELS)[number] | undefined,
          limit: input.limit as number | undefined,
        });
        const rows = await runNrql(config, query);
        return {
          logs: rows.map((r) => ({
            timestamp: r.timestamp ?? null,
            level: r.level == null ? null : String(r.level),
            message: maskSensitive(String(r.message ?? "")).slice(0, 500),
            trace_id: r.trace_id == null ? null : String(r.trace_id),
          })),
        };
      },
    },

    nrql: {
      effect: "read",
      description:
        "Run an arbitrary NRQL query. Use it when no dedicated action fits; prefer the dedicated ones, whose queries are fixed and therefore reproducible.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "A complete NRQL statement." } },
        required: ["query"],
      },
      async run(config, input) {
        const results = await runNrql(config, String(input.query));
        return { results };
      },
    },
  },
};

const gitlabIdSchema = {
  anyOf: [
    { type: "string", minLength: 1 },
    { type: "integer", minimum: 1 },
  ],
  description: "Numeric ID or full namespace path.",
};
const gitlabLimitSchema = { type: "integer", minimum: 1, maximum: 50, default: 20 };

const gitlab: Connector = {
  id: "gitlab",
  name: "GitLab",
  description:
    "Search code, read files, list commits and inspect merge requests. Read-only operations.",
  category: "productivity",
  authType: "token",
  fields: [
    {
      key: "baseUrl",
      label: "GitLab URL",
      type: "url",
      placeholder: "https://gitlab.com",
      required: false,
      help: "Defaults to https://gitlab.com. For self-managed GitLab, enter the instance URL without /api/v4.",
    },
    {
      key: "token",
      label: "Personal access token",
      type: "password",
      required: true,
      help: "Create a personal access token with the read_api scope. Only GET requests are supported.",
    },
  ],
  async test(config) {
    try {
      await gitlabTest(config);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  actions: {
    search_code: {
      effect: "read",
      description:
        "Search project or group code; return path, startline, snippet and projectId (numeric ID as a string) for chaining into read_file or list_commits. Include projectPath when supplied and webUrl when the project path, file path and ref are known. Group search requires advanced or exact code search. Ref support depends on the search backend.",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["project", "group"] },
          id: {
            ...gitlabIdSchema,
            description:
              "Project or group ID/path selected by scope. Each match carries its own projectId; pass that to read_file or list_commits, not the group ID.",
          },
          query: { type: "string", minLength: 1 },
          onlySource: {
            type: "boolean",
            default: false,
            description:
              "Exclude data/config, translation, fixture, snapshot and test matches (default false). Retains source and unclassified files. Results are ranked source-first before applying limit.",
          },
          ref: {
            type: "string",
            description: "Optional branch or tag; supported by project search.",
          },
          limit: gitlabLimitSchema,
        },
        required: ["scope", "id", "query"],
      },
      run: gitlabSearchCode,
    },
    read_file: {
      effect: "read",
      description:
        "Read UTF-8 file text and full-file byte size. Pass a search_code match's startline as aroundLine to return a line window with fromLine, toLine, totalLines and truncated: true. Whole-file reads are limited to 200 KiB; all responses are capped at 8 MiB including base64 and JSON.",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            ...gitlabIdSchema,
            description:
              "Numeric ID or full namespace path. Accepts projectId from a search_code match.",
          },
          path: { type: "string", minLength: 1 },
          aroundLine: {
            type: "integer",
            description:
              "Optional 1-based center line. Pass startline from a search_code match directly. Clamped to the first or last line when out of range.",
          },
          contextLines: {
            type: "integer",
            minimum: 0,
            maximum: 200,
            default: 40,
            description:
              "Lines before and after aroundLine (default 40, capped at 200). Ignored without aroundLine.",
          },
          ref: {
            type: "string",
            default: "HEAD",
            description: "Branch, tag or commit. Defaults to the default branch (HEAD).",
          },
        },
        required: ["project", "path"],
      },
      run: gitlabReadFile,
    },
    list_commits: {
      effect: "read",
      description: "List recent commit IDs, titles, author names and committed dates.",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            ...gitlabIdSchema,
            description:
              "Numeric ID or full namespace path. Accepts projectId from a search_code match.",
          },
          path: { type: "string" },
          since: { type: "string", description: "ISO 8601 lower date bound." },
          until: { type: "string", description: "ISO 8601 upper date bound." },
          limit: gitlabLimitSchema,
        },
        required: ["project"],
      },
      run: gitlabListCommits,
    },
    list_merge_requests: {
      effect: "read",
      description:
        "List merge requests of a project (one page, metadata only: iid, title, state, author username, branches, merged_at, created_at, web_url, merge_commit_sha). Use merged_since to find what shipped around an incident.",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            ...gitlabIdSchema,
            description:
              "Numeric ID or full namespace path. Accepts projectId from a search_code match.",
          },
          state: { type: "string", enum: ["opened", "merged", "closed", "all"], default: "merged" },
          merged_since: { type: "string", description: "ISO 8601 lower bound on merged_at." },
          search: { type: "string", maxLength: 100, description: "Matched against title." },
          target_branch: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 30, default: 10 },
        },
        required: ["project"],
      },
      run: gitlabListMergeRequests,
    },
    get_diff: {
      effect: "read",
      description:
        "Read the diff of one commit (commit_sha) or one merge request (mr_iid), never both. Capped at 20 files, 8 KB per file and 40 KB in total; `truncated` and `files_omitted` say what was left out, and `diff_unavailable` marks binary or too-large files. Only the first page of 100 files is read: when `more_pages` is true the diff has further files that were not read, so a `path` filter that matches nothing does not prove the file is absent. Use `path` to narrow to the files that matter.",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            ...gitlabIdSchema,
            description:
              "Numeric ID or full namespace path. Accepts projectId from a search_code match.",
          },
          commit_sha: { type: "string", pattern: "^[0-9a-fA-F]{7,40}$" },
          mr_iid: { type: "integer", minimum: 1 },
          path: {
            type: "string",
            description: "Keep only files whose old or new path contains this.",
          },
        },
        required: ["project"],
      },
      run: gitlabGetDiff,
    },
    compare_refs: {
      effect: "read",
      description:
        "Compare two refs (branch, tag or commit SHA) and return the commits between them plus the changed file paths. Use it to narrow suspects when you know the version where an error first appeared: pass the previous version's SHA as `from` and that version's SHA as `to`. Commits are capped by `limit` and files at 40; `truncated` says whether anything was left out.",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            ...gitlabIdSchema,
            description:
              "Numeric ID or full namespace path. Accepts projectId from a search_code match.",
          },
          from: { type: "string", minLength: 1, description: "The older ref: branch, tag or SHA." },
          to: { type: "string", minLength: 1, description: "The newer ref: branch, tag or SHA." },
          limit: gitlabLimitSchema,
        },
        required: ["project", "from", "to"],
      },
      run: gitlabCompareRefs,
    },
    get_merge_request: {
      effect: "read",
      description:
        "Read merge request metadata and unique changed file paths, including both sides of renames. No diffs are returned; GitLab server diff limits apply.",
      inputSchema: {
        type: "object",
        properties: { project: gitlabIdSchema, iid: { type: "integer", minimum: 1 } },
        required: ["project", "iid"],
      },
      run: gitlabGetMergeRequest,
    },
  },
};

const mcp: Connector = {
  id: "mcp",
  name: "MCP server",
  description: "Connect a Streamable HTTP MCP server and enable its tools for agents.",
  category: "custom",
  authType: "token",
  fields: [
    {
      key: "url",
      label: "Server URL",
      type: "url",
      required: true,
      placeholder: "https://mcp.example.com/mcp",
    },
    {
      key: "authHeader",
      label: "Authorization header",
      type: "password",
      help: "Optional complete Authorization value, such as Bearer followed by a token.",
    },
    {
      key: "toolAllowlist",
      label: "Tool allowlist",
      type: "text",
      placeholder: '["search", "read_document"]',
      help: "Optional JSON array of exact remote tool names. Explicitly listed tools may write or delete data. An empty array disables all tools.",
    },
    {
      key: "timeoutMs",
      label: "Timeout (milliseconds)",
      type: "text",
      placeholder: "20000",
      help: "Default 20000, maximum 60000; covers initialization and the operation.",
    },
  ],
  async test(config) {
    const { testMcpConnection } = await import("./mcp-client");
    return testMcpConnection(config);
  },
  actions: {},
};

export const CONNECTORS: Record<string, Connector> = {
  mcp,
  stripe,
  notion,
  postgres,
  resend,
  http,
  slack,
  discord,
  telegram,
  google: googleWorkspace,
  odoo,
  newrelic,
  gitlab,
};

export function getConnector(id: string): Connector | undefined {
  return CONNECTORS[id];
}

/** Public catalog (without runtime functions) for the UI. */
export function listConnectors() {
  return Object.values(CONNECTORS).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    category: c.category,
    authType: c.authType,
    needsOAuthApp: c.needsOAuthApp ?? false,
    fields: c.fields,
    actions: Object.entries(c.actions).map(([k, a]) => ({ key: k, description: a.description })),
  }));
}
