/**
 * Secret-shaped patterns shared by the server logger and the Sentry scrubber.
 * No `server-only` import: the client Sentry config uses this module too.
 */

export const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Anthropic / OpenAI / Anthropic-style keys
  [/sk-ant-api[0-9a-zA-Z_-]{20,}/g, "sk-ant-***REDACTED***"],
  [/sk-proj-[A-Za-z0-9_-]{20,}/g, "sk-proj-***REDACTED***"],
  [/sk-[A-Za-z0-9_-]{30,}/g, "sk-***REDACTED***"],
  // Google AI keys
  [/AIza[0-9A-Za-z_-]{30,}/g, "AIza***REDACTED***"],
  // Slack bot tokens
  [/xox[abpors]-[0-9A-Za-z-]{10,}/g, "xox*-***REDACTED***"],
  // Bearer headers en strings
  [/Bearer\s+[A-Za-z0-9._-]{20,}/gi, "Bearer ***REDACTED***"],
  // Basic auth
  [/Basic\s+[A-Za-z0-9+/=]{8,}/gi, "Basic ***REDACTED***"],
  // postgres://user:pass@host → postgres://user:***@host
  [/(postgres(?:ql)?:\/\/[^:@\s]+):([^@\s]+)@/gi, "$1:***REDACTED***@"],
  // JWT (3 segmentos base64url)
  [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "eyJ***REDACTED***"],
  // Other key formats this app holds or proxies: Orchester and Mnemosyne API
  // keys, Stripe secret and webhook keys, GitHub and GitLab tokens.
  [/\b(ok|mns)_live_[A-Za-z0-9_-]{8,}/g, "$1_live_***REDACTED***"],
  [/\b(sk|rk)_live_[A-Za-z0-9]{16,}/g, "$1_live_***REDACTED***"],
  [/\bwhsec_[A-Za-z0-9]{16,}/g, "whsec_***REDACTED***"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, "gh*_***REDACTED***"],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, "glpat-***REDACTED***"],
];

export function redactText(s: string): string {
  let out = s;
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  return out;
}

// Path segments that carry a bearer-style secret, and query params that do.
const SECRET_PATH = /(\/(?:webhooks?|exports|approvals|approve|invite)\/)[^/?#\s]+/g;
const SECRET_QUERY = /([?&](?:token|secret|key|signature|code)=)[^&#\s]*/g;

export function redactUrl(url: string): string {
  return url.replace(SECRET_PATH, "$1[redacted]").replace(SECRET_QUERY, "$1[redacted]");
}
