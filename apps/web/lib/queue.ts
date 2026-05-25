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
  return boss.send(name, data, sendOpts);
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
 * cron tick picks up missed work anyway. Also explicitly disable expiry:
 * cron jobs fire on schedule, pg-boss's default expireInSeconds=3600
 * would silently kill a long-running GDPR export then re-enqueue it,
 * producing concurrent multi-GB allocations.
 */
export async function schedule(name: string, cron: string, data: unknown = {}): Promise<void> {
  const boss = await getBoss();
  await ensureQueue(name);
  await boss.schedule(name, cron, data, {
    tz: "UTC",
    retryLimit: 0,
    expireInSeconds: 0,
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
export const JOB_BRAIN_EXTRACT = "brain:extract";
export const JOB_MNEMO_EXTRACT = "mnemo.extract";
export const JOB_BRAIN_COMPACTION = "brain:compaction";
export const JOB_BRAIN_DECAY = "brain:decay";
// v1.1 cost optimization: per-fact async embedding (eager handler) +
// periodic sweep (`mnemo.embed.batch`) that flushes unembedded facts
// in batches of 100. See `apps/web/worker/embed-batch-job.ts`.
export const JOB_MNEMO_EMBED_FACT = "mnemo.embed.fact";
export const JOB_MNEMO_EMBED_BATCH = "mnemo.embed.batch";
// v1.1 Layer 1 (Mnemosyne summary refresh): daily distillation cron
// that pre-warms `mnemo_summary` rows so the foreground turn never
// pays for an LLM round-trip. See apps/web/worker/summary-job.ts.
export const JOB_MNEMO_SUMMARY = "mnemo.summary";
export const JOB_KB_REINDEX = "kb:reindex";
export const JOB_WEBHOOK_DELIVER = "webhook:deliver";
export const JOB_USAGE_AGGREGATE = "usage:aggregate";
export const JOB_RETENTION = "data:retention";
export const JOB_AUDIT_VERIFY_ALL = "audit:verify_all_chains";
export const JOB_WORKSPACE_HARD_DELETE = "workspace:hard_delete";
export const JOB_GDPR_EXPORT = "gdpr:export";
export const JOB_GDPR_EXPORT_WATCHDOG = "gdpr:export:watchdog";
