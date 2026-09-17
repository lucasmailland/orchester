/**
 * Opt-in retry for steps that call external systems. Retries repeat the
 * external call, so the flow author is responsible for idempotency.
 */

export interface RetryConfig {
  attempts: number;
  backoffMs: number;
  maxBackoffMs: number;
}

export interface AttemptRecord {
  attempt: number;
  ok: boolean;
  status?: number;
  error?: string;
  delayMs?: number;
}

export type AttemptOutcome<T> =
  | { kind: "done"; value: T; status?: number }
  | { kind: "retry"; error: Error; status?: number; value?: T };

export interface RetryDeps {
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

const DEFAULT_DEPS: RetryDeps = {
  sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
  random: Math.random,
};

function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function parseRetryConfig(raw: unknown): RetryConfig | null {
  // The editor's json field stores its text as typed; MCP clients send an object.
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    attempts: int(r.attempts, 1, 1, 5),
    backoffMs: int(r.backoffMs, 1000, 0, 60_000),
    maxBackoffMs: int(r.maxBackoffMs, 30_000, 0, 300_000),
  };
}

/** Delay before retrying after `attempt` failed: doubling, capped, 50–100% jitter. */
export function backoffDelay(cfg: RetryConfig, attempt: number, random: () => number): number {
  const base = Math.min(cfg.maxBackoffMs, cfg.backoffMs * 2 ** (attempt - 1));
  return Math.round(base * (0.5 + random() / 2));
}

export async function runWithRetry<T>(
  cfg: RetryConfig,
  attemptFn: (attempt: number) => Promise<AttemptOutcome<T>>,
  deps: Partial<RetryDeps> = {}
): Promise<
  | { ok: true; value: T; status?: number; attempts: AttemptRecord[] }
  | { ok: false; error: Error; status?: number; value?: T; attempts: AttemptRecord[] }
> {
  const { sleep, random } = { ...DEFAULT_DEPS, ...deps };
  const attempts: AttemptRecord[] = [];
  for (let attempt = 1; ; attempt++) {
    const outcome = await attemptFn(attempt);
    if (outcome.kind === "done") {
      attempts.push({
        attempt,
        ok: true,
        ...(outcome.status !== undefined ? { status: outcome.status } : {}),
      });
      return {
        ok: true,
        value: outcome.value,
        ...(outcome.status !== undefined ? { status: outcome.status } : {}),
        attempts,
      };
    }
    const record: AttemptRecord = {
      attempt,
      ok: false,
      ...(outcome.status !== undefined ? { status: outcome.status } : {}),
      error: outcome.error.message,
    };
    attempts.push(record);
    if (attempt >= cfg.attempts) {
      return {
        ok: false,
        error: outcome.error,
        ...(outcome.status !== undefined ? { status: outcome.status } : {}),
        ...(outcome.value !== undefined ? { value: outcome.value } : {}),
        attempts,
      };
    }
    const delayMs = backoffDelay(cfg, attempt, random);
    record.delayMs = delayMs;
    await sleep(delayMs);
  }
}

/** A step failure that still has output worth recording (e.g. its attempts). */
export class StepFailure extends Error {
  readonly output: Record<string, unknown>;
  constructor(message: string, output: Record<string, unknown>) {
    super(message);
    this.name = "StepFailure";
    this.output = output;
  }
}
