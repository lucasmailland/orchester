import "server-only";

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
  /** Si requiere que el operador registre una app OAuth (no funciona sin sus creds). */
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
  description: "Leé balance, customers y facturas. Operaciones de lectura con tu secret key.",
  category: "payments",
  authType: "token",
  fields: [
    { key: "secretKey", label: "Secret key", type: "password", placeholder: "sk_live_… o sk_test_…", required: true, help: "Stripe → Developers → API keys." },
  ],
  async test(config) {
    const r = await fetchJson("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${config.secretKey}` },
    });
    if (!r.ok) return { ok: false, error: `Stripe ${r.status}: ${(r.json as { error?: { message?: string } })?.error?.message ?? r.text.slice(0, 120)}` };
    const mode = config.secretKey?.startsWith("sk_live") ? "live" : "test";
    return { ok: true, meta: { mode } };
  },
  actions: {
    get_balance: {
      description: "Devuelve el balance disponible y pendiente de la cuenta Stripe.",
      inputSchema: { type: "object", properties: {} },
      async run(config) {
        const r = await fetchJson("https://api.stripe.com/v1/balance", {
          headers: { Authorization: `Bearer ${config.secretKey}` },
        });
        return r.json;
      },
    },
    list_customers: {
      description: "Lista los últimos customers de Stripe.",
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
      description: "Lista las últimas facturas de Stripe.",
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
  description: "Buscá páginas y consultá bases de datos con un integration token.",
  category: "productivity",
  authType: "token",
  fields: [
    { key: "token", label: "Integration token", type: "password", placeholder: "ntn_… o secret_…", required: true, help: "notion.so/my-integrations → New integration." },
  ],
  async test(config) {
    const r = await fetchJson("https://api.notion.com/v1/users/me", {
      headers: { Authorization: `Bearer ${config.token}`, "Notion-Version": "2022-06-28" },
    });
    if (!r.ok) return { ok: false, error: `Notion ${r.status}: ${r.text.slice(0, 120)}` };
    const name = (r.json as { name?: string; bot?: { workspace_name?: string } })?.bot?.workspace_name;
    return { ok: true, meta: name ? { workspace: name } : {} };
  },
  actions: {
    search: {
      description: "Busca páginas y bases de datos en Notion por texto.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
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
      description: "Consulta una base de datos de Notion por su ID.",
      inputSchema: { type: "object", properties: { databaseId: { type: "string" } }, required: ["databaseId"] },
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
  description: "Conectá una base externa de SOLO LECTURA para que los agentes consulten datos.",
  category: "data",
  authType: "connection_string",
  fields: [
    { key: "connectionString", label: "Connection string", type: "password", placeholder: "postgresql://user:pass@host:5432/db", required: true, help: "Usá un usuario con permisos de solo lectura." },
  ],
  async test(config) {
    const cs = config.connectionString ?? "";
    if (!cs) return { ok: false, error: "Connection string requerida" };
    try {
      const { assertPublicDbHost } = await import("@/lib/net-guard");
      assertPublicDbHost(cs);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "host bloqueado" };
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
        "Ejecuta una consulta SQL de SOLO LECTURA (SELECT) contra la base externa. Rechaza statements de escritura.",
      inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
      async run(config, input) {
        const raw = String(input.sql ?? "").trim();
        // Defensa 1 (regex): solo SELECT/WITH, bloquea DML/DDL obvios.
        if (!/^(select|with)\b/i.test(raw) || /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy)\b/i.test(raw)) {
          throw new Error("Solo se permiten consultas de lectura (SELECT/WITH).");
        }
        const { assertPublicDbHost } = await import("@/lib/net-guard");
        assertPublicDbHost(config.connectionString ?? "");
        const { default: pg } = await import("postgres");
        const sql = pg(config.connectionString ?? "", { max: 1, idle_timeout: 5, connect_timeout: 8 });
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
  description: "Enviá emails transaccionales desde tus agentes y flujos.",
  category: "email",
  authType: "token",
  fields: [
    { key: "apiKey", label: "API key", type: "password", placeholder: "re_…", required: true },
    { key: "from", label: "From", type: "text", placeholder: "Orchester <no-reply@tu-dominio.com>", required: true },
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
      description: "Envía un email vía Resend.",
      inputSchema: {
        type: "object",
        properties: { to: { type: "string" }, subject: { type: "string" }, text: { type: "string" } },
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
  description: "Conectá cualquier API REST. Bearer token opcional. Los agentes pueden llamarla.",
  category: "custom",
  authType: "token",
  fields: [
    { key: "baseUrl", label: "Base URL", type: "url", placeholder: "https://api.tu-servicio.com", required: true },
    { key: "bearerToken", label: "Bearer token (opcional)", type: "password", placeholder: "token", required: false },
  ],
  async test(config) {
    const baseUrl = config.baseUrl ?? "";
    if (!baseUrl) return { ok: false, error: "Base URL requerida" };
    try {
      const { assertPublicUrl } = await import("@/lib/net-guard");
      assertPublicUrl(baseUrl);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "URL bloqueada" };
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
      description: "Hace una request HTTP a {baseUrl}{path}. method GET/POST/PUT/DELETE; body JSON opcional.",
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
  description: "Calendar, Drive, Gmail. Requiere registrar una app OAuth en Google Cloud.",
  category: "productivity",
  authType: "oauth",
  needsOAuthApp: true,
  fields: [
    { key: "clientId", label: "OAuth Client ID", type: "text", required: true, help: "Google Cloud Console → Credentials." },
    { key: "clientSecret", label: "OAuth Client Secret", type: "password", required: true },
  ],
  async test(config) {
    if (!config.clientId || !config.clientSecret)
      return { ok: false, error: "Faltan client ID / secret de la app OAuth." };
    // Sin completar el flow OAuth (consent + tokens) no podemos llamar a las APIs.
    return { ok: false, error: "App OAuth configurada. Completá el flujo de autorización para conectar (pendiente de consent)." };
  },
  actions: {},
};

const slack: Connector = {
  id: "slack",
  name: "Slack",
  description: "Mensajería del bot. La configuración de canal vive en /channels.",
  category: "messaging",
  authType: "token",
  fields: [
    { key: "botToken", label: "Bot token", type: "password", placeholder: "xoxb-…", required: true },
  ],
  async test(config) {
    const r = await fetchJson("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.botToken}` },
    });
    const j = r.json as { ok?: boolean; team?: string; error?: string };
    if (!j?.ok) return { ok: false, error: `Slack: ${j?.error ?? "auth falló"}` };
    return { ok: true, meta: { team: j.team } };
  },
  actions: {
    post_message: {
      description: "Publica un mensaje en un canal de Slack.",
      inputSchema: {
        type: "object",
        properties: { channel: { type: "string" }, text: { type: "string" } },
        required: ["channel", "text"],
      },
      async run(config, input) {
        const r = await fetchJson("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${config.botToken}`, "content-type": "application/json" },
          body: JSON.stringify({ channel: String(input.channel), text: String(input.text) }),
        });
        return r.json;
      },
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
  google: googleWorkspace,
};

export function getConnector(id: string): Connector | undefined {
  return CONNECTORS[id];
}

/** Catálogo público (sin funciones) para la UI. */
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
