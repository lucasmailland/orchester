import "server-only";

/**
 * Job queue backed by Postgres (vía pg-boss).
 * Cero Redis. Cero broker externo. Usa la misma DB que el resto de la app.
 *
 * pg-boss crea sus propias tablas en el schema `pgboss` la primera vez
 * que se llama a `start()`. Es idempotente.
 *
 * Ejemplo:
 *   import { enqueue, registerWorker } from "@/lib/queue";
 *
 *   // En request handler:
 *   await enqueue("flow:run", { flowId, input });
 *
 *   // En worker process:
 *   registerWorker("flow:run", async (job) => {
 *     await runFlow(job.data.flowId, job.data.input);
 *   });
 */

// pg-boss se carga lazy para no romper builds donde no está instalado todavía.
// Se agrega al package.json como parte del pivot OSS.
type PgBoss = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Job<T = unknown> = { id: string; name: string; data: T };

let _bossPromise: Promise<PgBoss> | null = null;

async function getBoss(): Promise<PgBoss> {
  if (_bossPromise) return _bossPromise;
  _bossPromise = (async () => {
    const { default: PgBossCtor } = await import("pg-boss");
    const cs = process.env["DATABASE_URL"];
    if (!cs) throw new Error("DATABASE_URL not set — required for pg-boss queue");
    const boss = new PgBossCtor({
      connectionString: cs,
      // Limpia jobs completados después de 7 días para que la tabla no crezca
      archiveCompletedAfterSeconds: 60 * 60 * 24 * 7,
      retentionDays: 30,
    });
    boss.on("error", async (err: Error) => {
      const { safeLogError } = await import("./safe-log");
      safeLogError("[queue] pg-boss error:", err);
    });
    await boss.start();
    return boss;
  })();
  return _bossPromise;
}

/**
 * pg-boss v10 exige que la queue exista (fila en `pgboss.queue`) ANTES de
 * send/work/schedule — en v9 era implícita. createQueue tira si ya existe,
 * así que cacheamos por nombre e ignoramos el conflicto de duplicado.
 */
const _ensuredQueues = new Map<string, Promise<void>>();
async function ensureQueue(name: string): Promise<void> {
  let p = _ensuredQueues.get(name);
  if (!p) {
    p = (async () => {
      const boss = await getBoss();
      try {
        await boss.createQueue(name);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/already exists|duplicate/i.test(msg)) throw e;
      }
    })();
    _ensuredQueues.set(name, p);
  }
  return p;
}

export interface EnqueueOptions {
  /** Delay en segundos antes de ejecutar */
  startAfterSeconds?: number;
  /** Máximo reintentos (default 3) */
  retryLimit?: number;
  /** Backoff exponencial: delay base en segundos */
  retryBackoff?: boolean;
  /** TTL del job (segundos). Si no se ejecuta en este tiempo, se descarta */
  expireInSeconds?: number;
  /** Singleton key — sólo permite 1 job activo con esta key */
  singletonKey?: string;
}

/**
 * v1.6 G1-1: Defensive enqueue against 40P01 (deadlock_detected).
 *
 * The pg-boss `createQueue` + first `send` on the same name from two
 * concurrent admin endpoints (e.g. run-consolidation racing run-auto-pin)
 * can deadlock on the `pgboss.queue` row — Postgres reports SQLSTATE
 * 40P01. Postgres aborts ONE of the transactions; the other proceeds.
 * Retrying the aborted enqueue exactly once is safe: pg-boss state is
 * already self-consistent at that point.
 */
async function isDeadlockError(err: unknown): Promise<boolean> {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  if (code === "40P01") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /deadlock detected/i.test(msg);
}

export async function enqueue<T = unknown>(
  name: string,
  data: T,
  opts: EnqueueOptions = {}
): Promise<string | null> {
  const boss = await getBoss();
  await ensureQueue(name);
  const sendOpts: Record<string, unknown> = {
    retryLimit: opts.retryLimit ?? 3,
    retryBackoff: opts.retryBackoff ?? true,
    expireInSeconds: opts.expireInSeconds ?? 60 * 60, // 1h default
  };
  if (opts.startAfterSeconds) sendOpts["startAfter"] = opts.startAfterSeconds;
  if (opts.singletonKey) sendOpts["singletonKey"] = opts.singletonKey;
  try {
    return await boss.send(name, data, sendOpts);
  } catch (e) {
    if (await isDeadlockError(e)) {
      const { safeLogError } = await import("./safe-log");
      safeLogError(`[queue] enqueue "${name}" hit 40P01, retrying once:`, e);
      // Best-effort: re-warm the queue row in case the deadlock was on it.
      _ensuredQueues.delete(name);
      await ensureQueue(name);
      return boss.send(name, data, sendOpts);
    }
    throw e;
  }
}

export type WorkerHandler<T = unknown> = (job: Job<T>) => Promise<void>;

export async function registerWorker<T = unknown>(
  name: string,
  handler: WorkerHandler<T>,
  opts: { teamSize?: number; teamConcurrency?: number } = {}
): Promise<void> {
  const boss = await getBoss();
  await ensureQueue(name);
  await boss.work(
    name,
    {
      teamSize: opts.teamSize ?? 1,
      teamConcurrency: opts.teamConcurrency ?? 1,
    },
    async (job: Job<T> | Job<T>[]) => {
      // pg-boss v10 entrega array si fetchSize > 1; v9 entrega objeto
      const jobs = Array.isArray(job) ? job : [job];
      for (const j of jobs) {
        try {
          await handler(j);
        } catch (e) {
          const { safeLogError } = await import("./safe-log");
          safeLogError(`[queue] handler "${name}" threw:`, e);
          throw e; // pg-boss decide reintento
        }
      }
    }
  );
  console.log(`[queue] worker registered: ${name}`);
}

/**
 * Schedule recurrente (cron).
 *
 * R2 worker audit C1+C4: hard-coded `retryLimit: 0` so transient failure
 * in a cron does NOT cause double-execution. Hard-delete, retention and
 * audit-verify are non-idempotent in the worst case (concurrent
 * hard-delete = race; concurrent retention = delete twice). The next
 * cron tick picks up missed work anyway. We push expiry far out (24h)
 * instead of disabling: cron jobs fire on schedule, pg-boss's default
 * expireInSeconds=3600 would silently kill a long-running GDPR export
 * then re-enqueue it, producing concurrent multi-GB allocations. pg-boss
 * 11+ asserts expireInSeconds >= 1 so we cannot use 0; pg-boss also caps
 * expiration at strictly < 24 hours, so we use 23 (the largest legal value)
 * to cover every long-running cron in the system (GDPR export, retention).
 */
export async function schedule(name: string, cron: string, data: unknown = {}): Promise<void> {
  const boss = await getBoss();
  await ensureQueue(name);
  await boss.schedule(name, cron, data, {
    tz: "UTC",
    retryLimit: 0,
    expireInHours: 23,
  });
}

export async function shutdownQueue(): Promise<void> {
  if (!_bossPromise) return;
  const boss = await _bossPromise;
  await boss.stop({ graceful: true, timeout: 30_000 });
  _bossPromise = null;
}

// ─── Job names (registro central, evita typos) ──────────────────

export const JOB_FLOW_RUN = "flow:run";
export const JOB_FLOW_REAP = "flow:reap";
export const JOB_KB_INGEST = "kb:ingest";
// Phase 3 (2026-06-05): every JOB_BRAIN_* and JOB_MNEMO_* used to be
// registered here for the in-process workers. After the service
// extraction those crons run inside @mnemosyne/server and are not
// orchester's concern. The names are intentionally not re-exported —
// any host code that still references them would be dead code and
// will fail to import, signalling it should be deleted or rewritten.
export const JOB_KB_REINDEX = "kb:reindex";
export const JOB_WEBHOOK_DELIVER = "webhook:deliver";
export const JOB_USAGE_AGGREGATE = "usage:aggregate";
export const JOB_RETENTION = "data:retention";
export const JOB_AUDIT_VERIFY_ALL = "audit:verify_all_chains";
export const JOB_WORKSPACE_HARD_DELETE = "workspace:hard_delete";
export const JOB_GDPR_EXPORT = "gdpr:export";
export const JOB_GDPR_EXPORT_WATCHDOG = "gdpr:export:watchdog";

/**
 * v1.6 G1-1: Canonical list of every queue the worker process owns.
 *
 * The worker pre-creates these at boot via `preCreateAllQueues`, so the
 * first admin enqueue (e.g. POST /api/mnemo/admin/run-consolidation) does
 * NOT race pg-boss's lazy `createQueue` + `send` deadlock window.
 *
 * Keep this list in sync with the `await registerWorker(...)` calls in
 * `apps/web/worker/index.ts`. Adding a queue here is cheap — it just
 * means one extra row pre-created in `pgboss.queue` at boot.
 */
export const ALL_QUEUES: readonly string[] = [
  JOB_FLOW_RUN,
  JOB_FLOW_REAP,
  JOB_KB_INGEST,
  JOB_KB_REINDEX,
  JOB_WEBHOOK_DELIVER,
  JOB_USAGE_AGGREGATE,
  JOB_RETENTION,
  JOB_AUDIT_VERIFY_ALL,
  JOB_WORKSPACE_HARD_DELETE,
  JOB_GDPR_EXPORT,
  JOB_GDPR_EXPORT_WATCHDOG,
];

/**
 * v1.6 G1-1: Pre-create every queue row at worker boot.
 *
 * Idempotent via `ensureQueue` (duplicates swallowed). Wraps every
 * createQueue in its own try/catch so one bad name doesn't abort the
 * whole boot. The admin endpoints that ran into the deadlock
 * (run-consolidation, run-auto-pin) call `enqueue` directly from the
 * request handler — without this pre-create the FIRST enqueue triggers
 * pg-boss's lazy createQueue path which is what races.
 */
export async function preCreateAllQueues(): Promise<void> {
  const { safeLogError } = await import("./safe-log");
  await getBoss(); // ensure boss.start() completed first
  for (const name of ALL_QUEUES) {
    try {
      await ensureQueue(name);
    } catch (e) {
      safeLogError(`[queue] preCreateAllQueues failed for "${name}":`, e);
      // continue — one bad queue must not abort the whole boot
    }
  }
}
