import { redactText, redactUrl } from "./secret-patterns";

const SECRET_HEADERS = new Set([
  "cookie",
  "authorization",
  "x-telegram-bot-api-secret-token",
  "x-orchester-signature",
]);

interface ScrubbableEvent {
  request?: {
    url?: string;
    query_string?: unknown;
    cookies?: unknown;
    headers?: Record<string, unknown>;
  };
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
}

/** Sentry `beforeSend`: strips URL tokens, auth headers and secret-shaped text. Pure. */
export function scrubSentryEvent<E extends ScrubbableEvent>(event: E): E {
  const req = event.request;
  if (req) {
    if (req.url) req.url = redactUrl(req.url);
    if (typeof req.query_string === "string")
      req.query_string = redactUrl(`?${req.query_string}`).slice(1);
    else if (req.query_string)
      req.query_string = redactUrl(`?${JSON.stringify(req.query_string)}`).slice(1);
    delete req.cookies;
    if (req.headers) {
      for (const k of Object.keys(req.headers)) {
        if (SECRET_HEADERS.has(k.toLowerCase())) delete req.headers[k];
      }
    }
  }
  if (event.message) event.message = redactText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = redactText(ex.value);
  }
  return event;
}

/** Sentry `beforeBreadcrumb`: redacts secrets in navigation/fetch/xhr URLs. */
export function scrubBreadcrumb<B extends { data?: Record<string, unknown> }>(crumb: B): B {
  const d = crumb.data;
  if (d)
    for (const k of ["url", "from", "to"]) if (typeof d[k] === "string") d[k] = redactUrl(d[k]);
  return crumb;
}
