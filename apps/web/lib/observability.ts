import "server-only";
import crypto from "node:crypto";

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
