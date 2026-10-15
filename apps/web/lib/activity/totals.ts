import type { ActivityTokens, OutcomeCounts, SpendTotals } from "./types";

/**
 * Folding the grouped rows the totals queries return into the shapes the
 * page shows. Pure, so the arithmetic is tested without a database.
 */

/** Longest list a breakdown returns. */
export const MAX_BREAKDOWN = 50;

export interface OutcomeCountRow {
  key: string | null;
  outcome: string;
  count: number;
}

function emptyCounts(): OutcomeCounts {
  return { total: 0, ok: 0, error: 0, refused: 0 };
}

function addOutcome(counts: OutcomeCounts, outcome: string, count: number): void {
  counts.total += count;
  if (outcome === "ok" || outcome === "error" || outcome === "refused") counts[outcome] += count;
}

/** Null keys first, then by code unit. */
function compareKeys(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/** One entry per key, busiest first. */
export function foldOutcomeCounts(
  rows: OutcomeCountRow[],
  max = MAX_BREAKDOWN
): Array<{ key: string | null } & OutcomeCounts> {
  const byKey = new Map<string | null, OutcomeCounts>();
  for (const row of rows) {
    let counts = byKey.get(row.key);
    if (!counts) byKey.set(row.key, (counts = emptyCounts()));
    addOutcome(counts, row.outcome, row.count);
  }
  return [...byKey.entries()]
    .map(([key, counts]) => ({ key, ...counts }))
    .sort((a, b) => b.total - a.total || compareKeys(a.key, b.key))
    .slice(0, max);
}

export function sumOutcomeCounts(rows: OutcomeCountRow[]): OutcomeCounts {
  const counts = emptyCounts();
  for (const row of rows) addOutcome(counts, row.outcome, row.count);
  return counts;
}

export interface SpendRow {
  key: string | null;
  events: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  cacheWrite: number;
  cacheRead: number;
  tokensTotal: number;
}

/** Costs are added in millionths of a dollar, the precision `cost_usd` keeps. */
const MICROS = 1_000_000;

interface SpendAcc {
  events: number;
  micros: number;
  tokens: { in: number; out: number; cacheWrite: number; cacheRead: number; total: number };
}

function emptyAcc(): SpendAcc {
  return { events: 0, micros: 0, tokens: { in: 0, out: 0, cacheWrite: 0, cacheRead: 0, total: 0 } };
}

function addSpend(acc: SpendAcc, row: SpendRow): void {
  acc.events += row.events;
  acc.micros += Math.round(row.costUsd * MICROS);
  acc.tokens.in += row.tokensIn;
  acc.tokens.out += row.tokensOut;
  acc.tokens.cacheWrite += row.cacheWrite;
  acc.tokens.cacheRead += row.cacheRead;
  acc.tokens.total += row.tokensTotal;
}

function finish(acc: SpendAcc): SpendTotals {
  const tokens: ActivityTokens = { ...acc.tokens };
  return { events: acc.events, costUsd: acc.micros / MICROS, tokens };
}

/** One entry per key, costliest first. */
export function foldSpend(
  rows: SpendRow[],
  max = MAX_BREAKDOWN
): Array<{ key: string | null } & SpendTotals> {
  const byKey = new Map<string | null, SpendAcc>();
  for (const row of rows) {
    let acc = byKey.get(row.key);
    if (!acc) byKey.set(row.key, (acc = emptyAcc()));
    addSpend(acc, row);
  }
  return [...byKey.entries()]
    .map(([key, acc]) => ({ key, micros: acc.micros, ...finish(acc) }))
    .sort((a, b) => b.micros - a.micros || b.events - a.events || compareKeys(a.key, b.key))
    .slice(0, max)
    .map(({ micros: _micros, ...rest }) => rest);
}

export function sumSpend(rows: SpendRow[]): SpendTotals {
  const acc = emptyAcc();
  for (const row of rows) addSpend(acc, row);
  return finish(acc);
}

/** Length of the integration key a hashed MCP tool name keeps (see `mcpHashedToolName`). */
export const HASHED_KEY_LENGTH = 20;

/**
 * The integration an MCP tool call went to. `tool_call.integration_id` is the
 * key inside `mcp__<key>__<tool>`: the integration's id for a readable tool
 * name, or only its first 20 characters when the name had to be hashed (see
 * `mcpToolName`). A prefix that fits more than one integration matches none.
 */
export function matchIntegration<T extends { id: string }>(
  key: string,
  integrations: readonly T[]
): T | null {
  const exact = integrations.find((integration) => integration.id === key);
  if (exact) return exact;
  if (key.length !== HASHED_KEY_LENGTH) return null;
  const candidates = integrations.filter((integration) => integration.id.startsWith(key));
  return candidates.length === 1 ? candidates[0]! : null;
}
