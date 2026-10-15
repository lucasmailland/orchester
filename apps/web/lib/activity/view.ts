import { MAX_RANGE_DAYS, type ActivityKind, type ActivityOutcome } from "./types";

/**
 * State of the activity page's filters and the pure helpers around it: the
 * range a preset stands for, the query string sent to the endpoints, and
 * number formatting. No React here, so it is tested on its own.
 */

export type RangePreset = "24h" | "7d" | "30d" | "custom";

export interface ActivityViewState {
  preset: RangePreset;
  /** `datetime-local` values (local time), used when `preset` is custom. */
  customFrom: string;
  customTo: string;
  /** Empty means every kind. */
  kinds: ActivityKind[];
  agentId: string;
  flowId: string;
  /** "" for any, `type:<type>` for every integration of a type, `id:<id>` for one. */
  integration: string;
  outcome: "" | ActivityOutcome;
  ref: string;
}

export const DEFAULT_VIEW: ActivityViewState = {
  preset: "7d",
  customFrom: "",
  customTo: "",
  kinds: [],
  agentId: "",
  flowId: "",
  integration: "",
  outcome: "",
  ref: "",
};

/** Which agent read data through an MCP integration, and how often. */
export const MCP_VIEW: ActivityViewState = { ...DEFAULT_VIEW, integration: "type:mcp" };

export function isMcpView(state: ActivityViewState): boolean {
  return state.integration === "type:mcp";
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const PRESET_MS: Record<Exclude<RangePreset, "custom">, number> = {
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
};

/** The range the state stands for, or null when a custom range is not usable. */
export function rangeOf(state: ActivityViewState, now: Date): { from: Date; to: Date } | null {
  if (state.preset !== "custom") {
    return { from: new Date(now.getTime() - PRESET_MS[state.preset]), to: now };
  }
  if (!state.customFrom || !state.customTo) return null;
  const from = new Date(state.customFrom);
  const to = new Date(state.customTo);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (to.getTime() <= from.getTime()) return null;
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) return null;
  return { from, to };
}

/** Query string for the list and export endpoints, without a cursor. */
export function activityParams(state: ActivityViewState, now: Date): URLSearchParams | null {
  const range = rangeOf(state, now);
  if (!range) return null;
  const params = new URLSearchParams();
  params.set("from", range.from.toISOString());
  params.set("to", range.to.toISOString());
  if (state.kinds.length) params.set("kinds", state.kinds.join(","));
  if (state.agentId) params.set("agentId", state.agentId);
  if (state.flowId) params.set("flowId", state.flowId);
  if (state.integration.startsWith("type:")) {
    params.set("integrationType", state.integration.slice("type:".length));
  } else if (state.integration.startsWith("id:")) {
    params.set("integrationId", state.integration.slice("id:".length));
  }
  if (state.outcome) params.set("outcome", state.outcome);
  const ref = state.ref.trim();
  if (ref) params.set("ref", ref);
  return params;
}

export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (ms < HOUR_MS) {
    const seconds = Math.round(ms / 1_000);
    return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
  }
  const minutes = Math.round(ms / 60_000);
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}
