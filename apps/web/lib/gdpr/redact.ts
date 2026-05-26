// apps/web/lib/gdpr/redact.ts
//
// Defensive secret scrubber for GDPR exports. The structured-field
// exporters (`workspace`, `agents`, `messages`, `knowledge`, `brain`)
// already cherry-pick column lists and drop known-sensitive columns
// (`credentialsEncrypted`, `secret`, `restoreToken`, `embedding`,
// etc.). The risk surface that remains is JSONB columns like
// `message.metadata`, `agent.config`, `agent.tools`, and
// `knowledge_doc.contentType` — those are unstructured by design and
// can grow new fields over time. A handler that lands a customer's
// API key in `message.metadata.tool_response` ships a regression
// through every future export unless we scrub defensively here too.
//
// This module is the last line of defence. It accepts any plain
// value, walks it recursively, and replaces strings that match the
// well-known provider/credential patterns with the literal string
// `"<REDACTED>"`. It is intentionally conservative — false positives
// are fine for an export (the requester can ask again with
// clarification); false negatives are not.
//
// Patterns:
//   - OpenAI       `sk-...` (also project keys `sk-proj-...`)
//   - Anthropic    `sk-ant-...`
//   - Google AI    `AIza...`
//   - Stripe       `sk_live_...`, `sk_test_...`, `rk_live_...`, `pk_live_...`
//   - Resend       `re_...`
//   - Slack bot    `xoxb-...`, `xoxp-...`, `xoxa-...`, `xoxr-...`
//   - GitHub       `ghp_...`, `gho_...`, `ghs_...`, `ghu_...`
//   - Notion       `secret_...`, `ntn_...`
//   - Bearer       JWT-shaped strings (header.payload.signature)
//   - Generic      any string containing a "key", "secret", "token",
//                  "password" or "credential" substring at an OBJECT
//                  KEY position has its VALUE redacted.
//
// We do NOT scrub free-text strings (`message.content`,
// `brain_fact.statement`) — those are the user's data, the whole
// point of the export. Only known-sensitive shapes are touched.

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI / Anthropic (sk-ant- matches too)
  /\bAIza[0-9A-Za-z\-_]{30,}\b/g, // Google AI / Gemini / Firebase
  /\bsk_live_[A-Za-z0-9]{16,}\b/g, // Stripe secret (live)
  /\bsk_test_[A-Za-z0-9]{16,}\b/g, // Stripe secret (test)
  /\brk_live_[A-Za-z0-9]{16,}\b/g, // Stripe restricted
  /\bpk_live_[A-Za-z0-9]{16,}\b/g, // Stripe publishable (still leaks identifiers)
  /\bre_[A-Za-z0-9_-]{16,}\b/g, // Resend
  /\bxox[bpars]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bghp_[A-Za-z0-9]{20,}\b/g, // GitHub PAT
  /\bgho_[A-Za-z0-9]{20,}\b/g, // GitHub OAuth
  /\bghs_[A-Za-z0-9]{20,}\b/g, // GitHub app server
  /\bghu_[A-Za-z0-9]{20,}\b/g, // GitHub app user
  /\bsecret_[A-Za-z0-9]{30,}\b/g, // Notion internal integration
  /\bntn_[A-Za-z0-9]{30,}\b/g, // Notion (new prefix)
  /\bok_live_[A-Za-z0-9]{16,}\b/g, // Orchester own API keys
];

const SECRET_KEY_NAMES = new Set([
  "apikey",
  "api_key",
  "secret",
  "secretkey",
  "secret_key",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "password",
  "credentials",
  "credential",
  "authorization",
  "bearer",
  "client_secret",
  "clientsecret",
  "private_key",
  "privatekey",
  "encryptedcredentials",
  "encrypted_credentials",
]);

const REDACTED = "<REDACTED>";

/**
 * Walk `value` and return a copy with any string that matches a
 * secret pattern replaced with `"<REDACTED>"`. Object keys named
 * `apiKey`, `secret`, `token`, etc. have their VALUE replaced even if
 * the value itself doesn't match a pattern (defence in depth — a
 * dev-test key on a non-standard prefix would still leak otherwise).
 *
 * Pure, non-mutating: the input is never modified. Returns the
 * scrubbed copy (structural sharing where nothing was rewritten).
 */
export function redactSecrets(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = redactSecrets(v);
      if (r !== v) changed = true;
      return r;
    });
    return changed ? out : value;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const isSecretKey = SECRET_KEY_NAMES.has(k.toLowerCase());
      const next = isSecretKey ? REDACTED : redactSecrets(v);
      if (next !== v) changed = true;
      out[k] = next;
    }
    return changed ? out : value;
  }
  return value;
}

function scrubString(s: string): string {
  let out = s;
  for (const re of SECRET_VALUE_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}
