import "server-only";

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

/**
 * Escapes a value for embedding inside single quotes in NRQL. NRQL escapes with
 * a backslash, same as SQL string literals in most dialects.
 */
export function nrqlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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
