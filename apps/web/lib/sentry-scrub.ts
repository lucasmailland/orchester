import { redactText, redactUrl, SECRET_PARAM_NAME } from "./secret-patterns";

export const SECRET_HEADERS = new Set([
  "cookie",
  "referer",
  "referrer",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-telegram-bot-api-secret-token",
  "x-orchester-signature",
  "x-slack-signature",
  "x-signature-ed25519",
  "x-hub-signature",
  "x-hub-signature-256",
]);

const MAX_DEPTH = 10;

function scrubString(s: string): string {
  const out = redactText(redactUrl(s));
  if (!s.includes("%")) return out;
  // Encoded tokens (`exports%2Fabc`, `access%5Ftoken=`) slip past the plain patterns.
  try {
    const decoded = decodeURIComponent(s);
    const redacted = redactText(redactUrl(decoded));
    if (redacted !== decoded) return redacted;
  } catch {
    // malformed escape: keep the plain-redacted form
  }
  return out;
}

/** Recursively redacts every string in place. Cycle-safe; too-deep values are dropped. */
function deepScrub(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return scrubString(value);
  if (!value || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const rec = value as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    rec[k] = SECRET_HEADERS.has(k.toLowerCase())
      ? "[redacted]"
      : deepScrub(rec[k], depth + 1, seen);
  }
  return value;
}

function scrubQueryString(q: unknown): unknown {
  if (typeof q === "string") return redactUrl(`?${q}`).slice(1);
  if (Array.isArray(q)) {
    // [["token", "abc"], ...] tuples
    return q.map((pair) =>
      Array.isArray(pair) && typeof pair[0] === "string" && SECRET_PARAM_NAME.test(pair[0])
        ? [pair[0], "[redacted]", ...pair.slice(2)]
        : pair
    );
  }
  if (q && typeof q === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(q)) out[k] = SECRET_PARAM_NAME.test(k) ? "[redacted]" : v;
    return out;
  }
  return q;
}

interface ScrubbableEvent {
  request?: { query_string?: unknown; cookies?: unknown; headers?: Record<string, unknown> };
}

/**
 * Sentry `beforeSend` / `beforeSendTransaction`: drops secret headers and
 * cookies, then redacts every string anywhere in the event (extra, contexts,
 * breadcrumbs, spans, stack vars...). Mutates the event in place and returns it.
 */
export function scrubSentryEvent<E extends object>(event: E): E {
  const req = (event as ScrubbableEvent).request;
  if (req) {
    if (req.query_string) req.query_string = scrubQueryString(req.query_string);
    delete req.cookies;
    if (req.headers) {
      for (const k of Object.keys(req.headers))
        if (SECRET_HEADERS.has(k.toLowerCase())) delete req.headers[k];
    }
  }
  deepScrub(event);
  return event;
}

/** Sentry `beforeBreadcrumb`: redacts every string in the message and data. */
export function scrubBreadcrumb<B extends object>(crumb: B): B {
  deepScrub(crumb);
  return crumb;
}
