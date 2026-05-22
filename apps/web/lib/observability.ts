import "server-only";
// `crypto.randomUUID()` está disponible en globalThis (Web Crypto / Node 19+).
// NO importamos `node:crypto` para que el módulo sea Edge-runtime compatible
// (instrumentation.ts puede importarlo desde el middleware).

/**
 * Lightweight Sentry-compatible reporter. POSTs to the Sentry envelope
 * endpoint directly when SENTRY_DSN is set; otherwise logs to console.
 */

interface CaptureContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string; email?: string };
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
    console.log(JSON.stringify({ metric: name, value, ...(tags ?? {}), ts: new Date().toISOString() }));
  } catch {
    /* nunca romper el camino del caller por una métrica */
  }
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
