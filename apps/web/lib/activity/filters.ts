import {
  ACTIVITY_KINDS,
  ACTIVITY_OUTCOMES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_RANGE_DAYS,
  type ActivityCursor,
  type ActivityFilters,
  type ActivityKind,
  type ActivityOutcome,
} from "./types";

/**
 * Reading and checking the query string of the activity endpoints, and which
 * sources can answer a given set of filters. Pure: no database, no server
 * imports.
 */

export type ActivityQueryError =
  | "missing_range"
  | "invalid_date"
  | "invalid_range"
  | "range_too_long"
  | "invalid_kind"
  | "invalid_outcome"
  | "invalid_filter"
  | "invalid_cursor"
  | "invalid_limit";

export interface ActivityQuery {
  filters: ActivityFilters;
  cursor: ActivityCursor | null;
  limit: number;
}

export type ParsedActivityQuery =
  { ok: true; query: ActivityQuery } | { ok: false; error: ActivityQueryError; field: string };

const DAY_MS = 86_400_000;
/** A date, optionally with a time and a zone. Rejects bare epoch numbers. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
/** The cursor timestamp: UTC with exactly six fractional digits. */
const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const MAX_ID = 200;
const MAX_REF = 64; // the CHECK constraint on tool_call.ref
const INTEGRATION_TYPE = /^[a-z0-9_-]{1,64}$/i;

type IdFilter = "agentId" | "flowId" | "channelId" | "integrationId";
const ID_FILTERS: IdFilter[] = ["agentId", "flowId", "channelId", "integrationId"];

function fail(error: ActivityQueryError, field: string): ParsedActivityQuery {
  return { ok: false, error, field };
}

function parseDate(raw: string): Date | null {
  if (!ISO_DATE.test(raw)) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasControlChars(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/.test(value);
}

/** The value of a filter, trimmed; undefined when absent or blank. */
function optional(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value ? value : undefined;
}

export function parseActivityQuery(params: URLSearchParams): ParsedActivityQuery {
  const fromRaw = optional(params, "from");
  const toRaw = optional(params, "to");
  if (!fromRaw) return fail("missing_range", "from");
  if (!toRaw) return fail("missing_range", "to");
  const from = parseDate(fromRaw);
  if (!from) return fail("invalid_date", "from");
  const to = parseDate(toRaw);
  if (!to) return fail("invalid_date", "to");
  if (to.getTime() <= from.getTime()) return fail("invalid_range", "to");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) return fail("range_too_long", "to");

  const requested = params
    .getAll("kinds")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const kinds: ActivityKind[] = [];
  for (const kind of requested) {
    if (!(ACTIVITY_KINDS as readonly string[]).includes(kind)) return fail("invalid_kind", "kinds");
    if (!kinds.includes(kind as ActivityKind)) kinds.push(kind as ActivityKind);
  }

  const filters: ActivityFilters = {
    from,
    to,
    kinds: kinds.length ? kinds : [...ACTIVITY_KINDS],
  };

  for (const key of ID_FILTERS) {
    const value = optional(params, key);
    if (value === undefined) continue;
    if (value.length > MAX_ID || hasControlChars(value)) return fail("invalid_filter", key);
    filters[key] = value;
  }

  const integrationType = optional(params, "integrationType");
  if (integrationType !== undefined) {
    if (!INTEGRATION_TYPE.test(integrationType)) return fail("invalid_filter", "integrationType");
    filters.integrationType = integrationType;
  }

  const outcome = optional(params, "outcome");
  if (outcome !== undefined) {
    if (!(ACTIVITY_OUTCOMES as readonly string[]).includes(outcome)) {
      return fail("invalid_outcome", "outcome");
    }
    filters.outcome = outcome as ActivityOutcome;
  }

  const ref = optional(params, "ref");
  if (ref !== undefined) {
    if (ref.length > MAX_REF || hasControlChars(ref)) return fail("invalid_filter", "ref");
    filters.ref = ref;
  }

  let limit = DEFAULT_PAGE_SIZE;
  const limitRaw = optional(params, "limit");
  if (limitRaw !== undefined) {
    if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1) return fail("invalid_limit", "limit");
    limit = Math.min(Number(limitRaw), MAX_PAGE_SIZE);
  }

  let cursor: ActivityCursor | null = null;
  const cursorRaw = optional(params, "cursor");
  if (cursorRaw !== undefined) {
    cursor = decodeCursor(cursorRaw);
    if (!cursor) return fail("invalid_cursor", "cursor");
  }

  return { ok: true, query: { filters, cursor, limit } };
}

/** Opaque, URL-safe form of a cursor. */
export function encodeCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify({ at: cursor.at, id: cursor.id })).toString("base64url");
}

export function decodeCursor(raw: string): ActivityCursor | null {
  if (raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { at, id } = value as Record<string, unknown>;
  if (typeof at !== "string" || !CURSOR_AT.test(at)) return null;
  if (Number.isNaN(new Date(at).getTime())) return null;
  if (typeof id !== "string" || !id || id.length > 256 || hasControlChars(id)) return null;
  return { at, id };
}

/**
 * Which kinds can answer the filters. A kind that does not record what a
 * filter asks about is skipped instead of being returned unfiltered:
 *
 * | filter          | tool_call | model_usage | flow_run | conversation | config_change |
 * |-----------------|-----------|-------------|----------|--------------|---------------|
 * | agentId         | yes       | yes         | -        | yes          | target agent  |
 * | flowId          | yes       | yes         | yes      | -            | target flow   |
 * | channelId       | yes       | -           | -        | yes          | target channel|
 * | integrationId   | yes       | -           | -        | -            | target integ. |
 * | integrationType | yes       | -           | -        | -            | -             |
 * | outcome         | yes       | -           | ok/error | -            | -             |
 * | ref             | yes       | -           | -        | -            | -             |
 *
 * A config change has one target, so it is skipped when more than one of
 * agent, flow, channel and integration is asked for.
 */
export function applicableKinds(filters: ActivityFilters): ActivityKind[] {
  const f = filters;
  const supports: Record<ActivityKind, boolean> = {
    tool_call: true,
    model_usage: !f.channelId && !f.integrationId && !f.integrationType && !f.outcome && !f.ref,
    flow_run:
      !f.agentId &&
      !f.channelId &&
      !f.integrationId &&
      !f.integrationType &&
      !f.ref &&
      f.outcome !== "refused",
    conversation: !f.flowId && !f.integrationId && !f.integrationType && !f.outcome && !f.ref,
    config_change:
      !f.integrationType &&
      !f.outcome &&
      !f.ref &&
      ID_FILTERS.filter((key) => f[key] !== undefined).length <= 1,
  };
  return ACTIVITY_KINDS.filter((kind) => f.kinds.includes(kind) && supports[kind]);
}

/** The filters as plain JSON, for the audit entry an export writes. */
export function describeFilters(filters: ActivityFilters): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {
    from: filters.from.toISOString(),
    to: filters.to.toISOString(),
    kinds: [...filters.kinds],
  };
  for (const key of [...ID_FILTERS, "integrationType", "outcome", "ref"] as const) {
    const value = filters[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
