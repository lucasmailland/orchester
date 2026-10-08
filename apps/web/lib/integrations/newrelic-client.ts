import "server-only";
import { nrqlEscape } from "@/lib/text/escape";
export { nrqlEscape };

/**
 * New Relic NerdGraph client.
 *
 * Two things this module exists to absorb:
 *
 *  1. **NerdGraph reports errors with HTTP 200**, putting them in `errors[]` in
 *     the body. Checking the status code reads a failure as a success.
 *  2. **NRQL is a string language and app names come from an agent.** Every
 *     value interpolated into a query goes through `nrqlEscape` — an unescaped
 *     quote in a facet value would otherwise let a caller rewrite the query.
 */

const DEFAULT_ENDPOINT = "https://api.newrelic.com/graphql";

/** Windows and row counts are clamped: an agent asking for 30 days of raw rows
 *  is a timeout, not a query. */
const MAX_WINDOW_MINUTES = 1440;
const MAX_LIMIT = 100;

export interface NewRelicCredentials {
  accountId: string;
  apiKey: string;
  endpoint?: string;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export function buildErrorsQuery(appName: string, sinceMinutes = 30, limit = 20): string {
  const since = clamp(sinceMinutes, 1, MAX_WINDOW_MINUTES, 30);
  const rows = clamp(limit, 1, MAX_LIMIT, 20);
  return (
    `SELECT count(*) FROM TransactionError ` +
    `WHERE appName = '${nrqlEscape(appName)}' ` +
    `SINCE ${since} minutes ago ` +
    `FACET error.class, error.message ` +
    `LIMIT ${rows}`
  );
}

/**
 * Logs for one distributed trace.
 *
 * Deliberately `FROM Log WHERE trace_id = …` and not `FROM Span WHERE trace.id`:
 * `trace.id` on Span is New Relic's own identifier, while `trace_id` is the
 * attribute `@fichap-team/utils` writes onto every log line. Querying the former
 * with the latter's value returns zero rows and no error.
 */
export function buildTraceLogsQuery(traceId: string, limit = 100): string {
  const rows = clamp(limit, 1, MAX_LIMIT, 100);
  return (
    `SELECT timestamp, message, level, entity.name FROM Log ` +
    `WHERE trace_id = '${nrqlEscape(traceId)}' ` +
    `SINCE 1 day ago ORDER BY timestamp ASC LIMIT ${rows}`
  );
}

export function buildDeploymentsQuery(appName: string, limit = 5): string {
  const rows = clamp(limit, 1, MAX_LIMIT, 5);
  return (
    `SELECT timestamp, revision, user, description FROM Deployment ` +
    `WHERE appName = '${nrqlEscape(appName)}' ` +
    `SINCE 1 day ago ORDER BY timestamp DESC LIMIT ${rows}`
  );
}

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const MAX_FILTER_CHARS = 120;

function boundedInt(name: string, value: unknown, min: number, max: number, dflt: number): number {
  if (value === undefined || value === null) return dflt;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return n;
}

function requiredText(name: string, value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) throw new Error(`${name} is required.`);
  if (s.length > 200 || /[\u0000-\u001f]/.test(s)) throw new Error(`${name} is not valid.`);
  return s;
}

/**
 * A fragment for `LIKE '%…%'`. NRQL's only LIKE wildcard is `%` and it has no
 * escape for it, so a literal `%` cannot be searched for: it is rejected rather
 * than silently widening the match. Quotes and backslashes are escaped.
 */
function likeFragment(name: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  if (value.length > MAX_FILTER_CHARS) {
    throw new Error(`${name} must be at most ${MAX_FILTER_CHARS} characters.`);
  }
  if (value.includes("%")) throw new Error(`${name} cannot contain "%" (LIKE wildcard).`);
  if (/[\u0000-\u001f]/.test(value)) throw new Error(`${name} cannot contain control characters.`);
  return nrqlEscape(value);
}

export interface BrowserErrorsParams {
  appName: string;
  sinceHours?: number | undefined;
  messageContains?: string | undefined;
  pageContains?: string | undefined;
}

/** Fixed template on JavaScriptError; for Browser apps `appName` is the right filter. */
export function buildBrowserErrorsQuery(p: BrowserErrorsParams): string {
  const app = requiredText("appName", p.appName);
  const hours = boundedInt("since_hours", p.sinceHours, 1, 168, 24);
  const msg = likeFragment("message_contains", p.messageContains);
  const page = likeFragment("page_contains", p.pageContains);
  return (
    `SELECT count(*) AS count, latest(requestUri) AS sample_uri, latest(timestamp) AS last_seen ` +
    `FROM JavaScriptError WHERE appName = '${nrqlEscape(app)}'` +
    (msg !== undefined ? ` AND errorMessage LIKE '%${msg}%'` : "") +
    (page !== undefined ? ` AND requestUri LIKE '%${page}%'` : "") +
    ` FACET errorClass, errorMessage SINCE ${hours} hours ago LIMIT ${BROWSER_ERRORS_LIMIT}`
  );
}

export interface SearchLogsParams {
  service: string;
  sinceMinutes?: number | undefined;
  messageContains?: string | undefined;
  level?: LogLevel | undefined;
  limit?: number | undefined;
}

/**
 * Fixed template on Log. Filters `service.name` (not `appName`), drops health
 * probes only where the line carries a request uri, and selects the app's own
 * `trace_id` (never `trace.id`/`span.id`, which are the agent's).
 */
export function buildSearchLogsQuery(p: SearchLogsParams): string {
  const service = requiredText("service", p.service);
  const minutes = boundedInt("since_minutes", p.sinceMinutes, 5, 1440, 60);
  const rows = boundedInt("limit", p.limit, 1, 100, 30);
  const msg = likeFragment("message_contains", p.messageContains);
  let levelClause = "";
  if (p.level !== undefined) {
    if (!LOG_LEVELS.includes(p.level)) {
      throw new Error(`level must be one of: ${LOG_LEVELS.join(", ")}.`);
    }
    levelClause = ` AND level IN ('${p.level}', '${p.level.toUpperCase()}')`;
  }
  return (
    `SELECT timestamp, level, message, trace_id FROM Log ` +
    `WHERE service.name = '${nrqlEscape(service)}' ` +
    `AND (request.uri IS NULL OR request.uri NOT LIKE '%health%')` +
    levelClause +
    (msg !== undefined ? ` AND message LIKE '%${msg}%'` : "") +
    ` SINCE ${minutes} minutes ago ORDER BY timestamp DESC LIMIT ${rows}`
  );
}

export const BROWSER_ERRORS_LIMIT = 20;

function credentialsFrom(config: Record<string, string>): NewRelicCredentials {
  const accountId = (config.accountId ?? "").trim();
  const apiKey = (config.apiKey ?? "").trim();
  if (!accountId || !apiKey) {
    throw new Error("New Relic needs accountId and apiKey to be configured.");
  }
  const endpoint = (config.endpoint ?? "").trim();
  return { accountId, apiKey, ...(endpoint ? { endpoint } : {}) };
}

/** A User key starts with NRAK. A license key does not, and NerdGraph rejects it. */
export function looksLikeUserKey(apiKey: string): boolean {
  return apiKey.trim().toUpperCase().startsWith("NRAK");
}

export async function nerdgraph(
  config: Record<string, string>,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<unknown> {
  const c = credentialsFrom(config);
  const url = c.endpoint ?? DEFAULT_ENDPOINT;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  let text: string;
  let status: number;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Api-Key": c.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: ac.signal,
    });
    status = res.status;
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }

  let payload: { data?: unknown; errors?: { message?: string }[] };
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`NerdGraph returned a non-JSON response (HTTP ${status})`);
  }

  // Trap 1: the errors ride inside a 200.
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message ?? "unknown").join(" | "));
  }
  if (status >= 400) throw new Error(`NerdGraph request failed with HTTP ${status}`);
  return payload.data;
}

const NRQL_QUERY = `query($id: Int!, $q: Nrql!) {
  actor { account(id: $id) { nrql(query: $q) { results } } } }`;

/** Runs an NRQL query and returns just the rows. */
export async function runNrql(
  config: Record<string, string>,
  query: string
): Promise<Record<string, unknown>[]> {
  const c = credentialsFrom(config);
  const data = (await nerdgraph(config, NRQL_QUERY, {
    id: Number(c.accountId),
    q: query,
  })) as { actor?: { account?: { nrql?: { results?: Record<string, unknown>[] } } } };
  return data?.actor?.account?.nrql?.results ?? [];
}
