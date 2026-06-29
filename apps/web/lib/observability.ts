// `crypto.randomUUID()` está disponible en globalThis (Web Crypto / Node 19+).
// NO importamos `node:crypto` para que el módulo sea Edge-runtime compatible
// (instrumentation.ts puede importarlo desde el middleware).

/**
 * Lightweight Sentry-compatible reporter. POSTs to the Sentry envelope
 * endpoint directly when SENTRY_DSN is set; otherwise logs to console.
 *
 * Phase J.1 — opt-in @sentry/nextjs integration:
 * When SENTRY_DSN is set we ALSO lazy-load the official @sentry/nextjs SDK
 * (see getSentry()) and forward `recordMetric` + `logWithContext` to it.
 * When SENTRY_DSN is unset, the import is never resolved → zero runtime
 * cost, zero new module in the graph. Behaviour without the DSN is
 * byte-identical to the pre-J.1 codebase.
 */

interface CaptureContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string; email?: string };
}

/**
 * Minimal shape of the bits of @sentry/nextjs we use. Typed loosely
 * because the real types live behind a lazy import — pulling them at
 * the top would defeat the whole point of the guard.
 */
type SentryShim = {
  captureException: (e: unknown, hint?: unknown) => string | undefined;
  captureMessage: (msg: string, level?: string) => string | undefined;
  // metrics namespace — present on @sentry/nextjs ≥ 8.
  metrics?: {
    distribution: (
      name: string,
      value: number,
      data?: { tags?: Record<string, string | number> }
    ) => void;
  };
};

/**
 * Module-private cache for the lazy-loaded SDK. Three states:
 *   - undefined  → never attempted; first call decides
 *   - null       → DSN absent OR import failed; never retry
 *   - SentryShim → loaded and ready
 *
 * The `await import` resolves at most ONCE per process. When the DSN is
 * unset we short-circuit to `null` synchronously, so the import never
 * appears in the module graph for a self-host without Sentry.
 */
let sentryCache: SentryShim | null | undefined = undefined;

async function getSentry(): Promise<SentryShim | null> {
  if (sentryCache !== undefined) return sentryCache;
  if (!process.env["SENTRY_DSN"]) {
    sentryCache = null;
    return null;
  }
  try {
    const mod = (await import("@sentry/nextjs")) as unknown as SentryShim;
    sentryCache = mod;
    return mod;
  } catch {
    // Self-host without the optional dep installed — fall back to no-op.
    sentryCache = null;
    return null;
  }
}

/** Test-only: reset the lazy-load cache so a test can flip env vars between cases. */
export function __resetSentryCacheForTests(): void {
  sentryCache = undefined;
}

function parseDsn(dsn: string): { url: string; key: string } | null {
  const m = /^https:\/\/([^@]+)@(.+?)\/(\d+)$/.exec(dsn);
  if (!m) return null;
  return { url: `https://${m[2]!}/api/${m[3]!}/envelope/`, key: m[1]! };
}

export function captureException(err: unknown, ctx?: CaptureContext): void {
  const dsn = process.env["SENTRY_DSN"];
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  if (!dsn) {
    console.error("[observability]", message, stack, ctx);
    return;
  }

  // Phase J.1 — prefer the official @sentry/nextjs SDK when present. It
  // gives us breadcrumb/trace/release wiring for free and uses the same
  // DSN. We still kick off the lightweight fetch path as a fallback so a
  // missing optional dep doesn't drop the error on the floor.
  void getSentry().then((Sentry) => {
    if (Sentry) {
      Sentry.captureException(err, { tags: ctx?.tags, extra: ctx?.extra, user: ctx?.user });
    }
  });

  const parsed = parseDsn(dsn);
  if (!parsed) {
    console.error("[observability] invalid SENTRY_DSN", message);
    return;
  }
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: new Date().toISOString(),
    level: "error",
    platform: "node",
    environment: process.env["NODE_ENV"] ?? "production",
    exception: {
      values: [
        {
          type: err instanceof Error ? err.name : "Error",
          value: message,
          stacktrace: stack ? { frames: parseStack(stack) } : undefined,
        },
      ],
    },
    tags: ctx?.tags ?? {},
    extra: ctx?.extra ?? {},
    user: ctx?.user,
  };
  const envelope = [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
  fetch(parsed.url, {
    method: "POST",
    headers: {
      "content-type": "application/x-sentry-envelope",
      "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${parsed.key}`,
    },
    body: envelope,
  }).catch(() => {});
}

/**
 * Correlation IDs (D1). Genera un id corto y propagable que ata logs/errores de
 * un mismo request o run a través de capas (flow → llm-call → providers). No es
 * criptográfico: sólo para correlacionar líneas de log.
 */
export function newCorrelationId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Helper de log estructurado con contexto de correlación. Emite una línea JSON
 * (scrapeable) con el `correlationId` y cualquier contexto extra. No-op friendly:
 * un contexto vacío sigue siendo válido.
 */
export function logWithContext(
  level: "info" | "warn" | "error",
  message: string,
  ctx?: { correlationId?: string; [k: string]: unknown }
): void {
  const line = JSON.stringify({ level, message, ...(ctx ?? {}), ts: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  // Phase J.1 — forward error-level lines to Sentry when DSN is set. We
  // skip the import entirely when SENTRY_DSN is unset (getSentry()
  // short-circuits sync). The `errorCandidate` heuristic forwards real
  // Error instances passed through ctx.error to captureException;
  // otherwise we send a message.
  if (level !== "error") return;
  if (!process.env["SENTRY_DSN"]) return;
  const errorCandidate = ctx?.["error"];
  void getSentry().then((Sentry) => {
    if (!Sentry) return;
    if (errorCandidate instanceof Error) {
      Sentry.captureException(errorCandidate, { extra: ctx });
    } else {
      Sentry.captureMessage(message, "error");
    }
  });
}

/**
 * Métricas mínimas (D2). Por defecto structured-loggea la métrica como JSON
 * (prefijo `metric` para grep/scrape desde logs). Es un seam barato: cuando haya
 * un backend real (StatsD/OTel/Prometheus push) se cablea acá sin tocar callers.
 */
export function recordMetric(
  name: string,
  value: number,
  tags?: Record<string, string | number>
): void {
  try {
    console.log(
      JSON.stringify({ metric: name, value, ...(tags ?? {}), ts: new Date().toISOString() })
    );
  } catch {
    /* nunca romper el camino del caller por una métrica */
  }

  // Phase J.1 — also send to Sentry as a custom measurement when the
  // DSN is set. Lazy + cached: the `@sentry/nextjs` import is only
  // resolved if SENTRY_DSN is defined for this process (see getSentry()).
  if (!process.env["SENTRY_DSN"]) return;
  void getSentry().then((Sentry) => {
    if (!Sentry?.metrics) return;
    try {
      Sentry.metrics.distribution(name, value, tags ? { tags } : undefined);
    } catch {
      /* never break the caller path for a metric */
    }
  });
}

function parseStack(stack: string): Array<{ filename: string; function: string; lineno: number }> {
  return stack
    .split("\n")
    .slice(1, 11)
    .map((line) => {
      const m = /at\s+(.+?)\s+\((.+?):(\d+):\d+\)/.exec(line);
      if (!m) return null;
      return { function: m[1]!, filename: m[2]!, lineno: Number(m[3]!) };
    })
    .filter(Boolean) as Array<{ filename: string; function: string; lineno: number }>;
}
