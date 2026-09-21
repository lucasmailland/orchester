import "server-only";
import { discordWebhookUrl, discordSendMessage, discordSendEmbed } from "./discord-client";
import { telegramTest, telegramSendMessage } from "./telegram-client";
import {
  gitlabTest,
  gitlabSearchCode,
  gitlabReadFile,
  gitlabCompareRefs,
  gitlabListCommits,
  gitlabGetMergeRequest,
} from "./gitlab-client";
import {
  odooAuthenticate,
  odooExecute,
  htmlFromText,
  x2manyReplace,
  TICKET_PRIORITY,
  type TicketPriority,
} from "./odoo-client";
import {
  nerdgraph,
  runNrql,
  looksLikeUserKey,
  buildErrorsQuery,
  buildTraceLogsQuery,
  buildDeploymentsQuery,
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

export interface ConnectorAction {
  description: string;
  inputSchema: JsonSchema;
  run: (config: Record<string, string>, input: Record<string, unknown>) => Promise<unknown>;
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

    post_note: {
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
          body_text: { type: "string", description: "Note as plain text." },
          body: { type: "string", description: "Note as HTML. Overrides body_text." },
        },
        required: ["id"],
      },
      async run(config, input) {
        const model = String(input.model ?? "helpdesk.ticket");
        const body =
          typeof input.body === "string" ? input.body : htmlFromText(String(input.body_text ?? ""));
        if (!body.trim()) throw new Error("A note needs a body.");
        const messageId = await odooExecute(config, model, "message_post", [[Number(input.id)]], {
          body,
          message_type: "comment",
          // Without mt_note the message goes out to the customer as an email.
          subtype_xmlid: "mail.mt_note",
        });
        return { ok: true, message_id: messageId };
      },
    },

    execute: {
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
        const result = await odooExecute(
          config,
          String(input.model),
          String(input.method),
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

    nrql: {
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
    compare_refs: {
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

export const CONNECTORS: Record<string, Connector> = {
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
