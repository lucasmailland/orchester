import type { ActivityRow } from "./types";

/**
 * CSV for the activity export: RFC 4180 (comma separator, CRLF line ends,
 * fields with a comma, quote or line break quoted, inner quotes doubled),
 * UTF-8 with a byte order mark so spreadsheet apps read accents right.
 *
 * Spreadsheets run a cell that starts with `=`, `+`, `-` or `@` (and some
 * also with a tab or a carriage return) as a formula. Agent names, tool
 * inputs and error messages come from users and remote systems, so every
 * cell that starts with one of those gets a leading `'`, which makes the
 * spreadsheet show it as text.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text =
    typeof value === "string"
      ? value
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: unknown[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}

export const ACTIVITY_CSV_COLUMNS = [
  "at",
  "kind",
  "agent_id",
  "agent_name",
  "flow_id",
  "flow_name",
  "channel_id",
  "channel_name",
  "integration_type",
  "integration_id",
  "integration_name",
  "ref",
  "outcome",
  "tokens_in",
  "tokens_out",
  "tokens_cache_write",
  "tokens_cache_read",
  "tokens_total",
  "cost_usd",
  "duration_ms",
  "summary",
  "link",
  "id",
  "detail",
] as const;

function activityCells(row: ActivityRow): unknown[] {
  return [
    row.at,
    row.kind,
    row.agent?.id,
    row.agent?.name,
    row.flow?.id,
    row.flow?.name,
    row.channel?.id,
    row.channel?.name,
    row.integration?.type,
    row.integration?.id,
    row.integration?.name,
    row.ref,
    row.outcome,
    row.tokens?.in,
    row.tokens?.out,
    row.tokens?.cacheWrite,
    row.tokens?.cacheRead,
    row.tokens?.total,
    row.costUsd,
    row.durationMs,
    row.summary,
    row.link,
    row.id,
    row.detail,
  ];
}

export function activityCsv(rows: ActivityRow[]): string {
  let out = `﻿${csvLine([...ACTIVITY_CSV_COLUMNS])}`;
  for (const row of rows) out += csvLine(activityCells(row));
  return out;
}
