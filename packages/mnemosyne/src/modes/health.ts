// packages/mnemosyne/src/modes/health.ts
//
// §39 Operational Modes — Graceful Degradation: provider health tracker.
//
// Orchester is an AI agent platform — a workspace without an LLM provider
// doesn't exist in steady state. Mode A's real purpose is graceful
// degradation when the LLM provider becomes unavailable (outage, spend cap,
// rate limit, network partition, revoked key).
//
// This module records rolling-window samples per (workspaceId, providerKind)
// and exposes a synchronous `getProviderHealth` for the mode resolver.
//
// Window policy:
//   - Track last 10 samples within a 5 minute rolling window.
//   - Failure threshold: > 50% of samples failed → unhealthy.
//   - Recovery: 1 successful call while unhealthy → healthy again
//     (slow-start: we trust the first success as a probe). Subsequent
//     failures restart the unhealthy count.
//
// In-memory only — survives Next.js HMR via globalThis stash (mirrors
// packages/db/src/client.ts pattern). Restart resets state — that's fine,
// first call after restart re-probes the provider naturally.

export type ProviderKind = "chat" | "embedding" | "rerank";

export interface ProviderHealthSample {
  ts: number; // unix ms
  ok: boolean;
}

export interface ProviderHealth {
  chat: boolean;
  embedding: boolean;
  rerank: boolean;
}

interface TrackerState {
  /** ringbuffer of recent samples */
  samples: ProviderHealthSample[];
  /** sticky unhealthy flag — cleared on first success */
  unhealthy: boolean;
}

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_SAMPLES = 10;
const FAILURE_THRESHOLD = 0.5; // > 50% failures → unhealthy

type WorkspaceStore = Map<ProviderKind, TrackerState>;

interface GlobalStash {
  __mnemoProviderHealth?: Map<string, WorkspaceStore>;
}

// HMR-safe global stash (same pattern as packages/db/src/client.ts).
const globalForHealth = globalThis as unknown as GlobalStash;
function store(): Map<string, WorkspaceStore> {
  if (!globalForHealth.__mnemoProviderHealth) {
    globalForHealth.__mnemoProviderHealth = new Map();
  }
  return globalForHealth.__mnemoProviderHealth;
}

function getOrInitWorkspace(workspaceId: string): WorkspaceStore {
  const s = store();
  let ws = s.get(workspaceId);
  if (!ws) {
    ws = new Map();
    s.set(workspaceId, ws);
  }
  return ws;
}

function getOrInitTracker(workspaceId: string, kind: ProviderKind): TrackerState {
  const ws = getOrInitWorkspace(workspaceId);
  let t = ws.get(kind);
  if (!t) {
    t = { samples: [], unhealthy: false };
    ws.set(kind, t);
  }
  return t;
}

function pruneOld(samples: ProviderHealthSample[], now: number): ProviderHealthSample[] {
  // Drop samples outside the time window AND keep at most MAX_SAMPLES newest.
  const cutoff = now - WINDOW_MS;
  let trimmed = samples.filter((s) => s.ts >= cutoff);
  if (trimmed.length > MAX_SAMPLES) {
    trimmed = trimmed.slice(trimmed.length - MAX_SAMPLES);
  }
  return trimmed;
}

function isHealthy(t: TrackerState, now: number): boolean {
  // Prune in place to keep the buffer bounded.
  t.samples = pruneOld(t.samples, now);
  if (t.samples.length === 0) return true; // no signal = assume healthy (first call probes)
  const failures = t.samples.filter((s) => !s.ok).length;
  const failureRate = failures / t.samples.length;
  return failureRate <= FAILURE_THRESHOLD;
}

/**
 * Record the outcome of a provider call. `ok=false` after enough failures
 * inside the window flips the provider to "unhealthy" and subsequent
 * `getProviderHealth` reports it as down. A single `ok=true` while
 * unhealthy resets the sticky flag.
 */
export function recordProviderResult(workspaceId: string, kind: ProviderKind, ok: boolean): void {
  const t = getOrInitTracker(workspaceId, kind);
  const now = Date.now();
  t.samples.push({ ts: now, ok });
  t.samples = pruneOld(t.samples, now);

  if (ok && t.unhealthy) {
    // Recovery probe succeeded — wipe the window so we don't immediately
    // tip back into unhealthy from stale failures still inside the window.
    t.unhealthy = false;
    t.samples = [{ ts: now, ok: true }];
    return;
  }
  if (!ok && !isHealthy(t, now)) {
    t.unhealthy = true;
  }
}

/**
 * Read the current health of all tracked provider kinds for a workspace.
 * Defaults to healthy (true) when no samples have been recorded — the
 * first call probes naturally.
 */
export function getProviderHealth(workspaceId: string): ProviderHealth {
  const ws = store().get(workspaceId);
  const now = Date.now();
  const evaluate = (kind: ProviderKind): boolean => {
    const t = ws?.get(kind);
    if (!t) return true;
    if (t.unhealthy) return false;
    return isHealthy(t, now);
  };
  return {
    chat: evaluate("chat"),
    embedding: evaluate("embedding"),
    rerank: evaluate("rerank"),
  };
}

/**
 * Test helper. Wipes the stored samples for a workspace (or all workspaces
 * when called with no argument). Never call this from production code.
 */
export function resetProviderHealth(workspaceId?: string): void {
  if (workspaceId === undefined) {
    store().clear();
    return;
  }
  store().delete(workspaceId);
}
