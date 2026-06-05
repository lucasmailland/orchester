import "server-only";

/**
 * Sanitization de errores antes de loguearlos. Reemplaza patrones que parecen
 * secrets por `***REDACTED***`. Usar en lugar de `console.error(error)` cuando
 * hay riesgo de que el error mensaje incluya:
 *   - API keys (sk-ant-, sk-proj-, AIza-, xoxb-)
 *   - Bearer/Basic auth headers
 *   - JWT tokens
 *   - URLs con auth (postgres://user:pass@host)
 *
 * No es bullet-proof — un atacante que logre tirar errores con shape custom
 * puede bypasear. Pero captura los casos típicos de provider SDKs y libs
 * conocidas que incluyen el request en el error message.
 */

const PATTERNS: Array<[RegExp, string]> = [
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
];

export function redactSecrets(input: unknown): string {
  let str: string;
  if (input instanceof Error) {
    str = `${input.name}: ${input.message}\n${input.stack ?? ""}`;
  } else if (typeof input === "string") {
    str = input;
  } else {
    try {
      str = JSON.stringify(input);
    } catch {
      str = String(input);
    }
  }
  for (const [re, replacement] of PATTERNS) {
    str = str.replace(re, replacement);
  }
  return str;
}

/** Drop-in replacement de `console.error` que sanitiza el payload. */
export function safeLogError(prefix: string, err: unknown): void {
  console.error(prefix, redactSecrets(err));
}

/** Drop-in para warnings. */
export function safeLogWarn(prefix: string, payload: unknown): void {
  console.warn(prefix, redactSecrets(payload));
}
