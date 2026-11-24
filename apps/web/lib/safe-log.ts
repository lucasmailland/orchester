import "server-only";

import { SECRET_PATTERNS } from "./secret-patterns";

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
  for (const [re, replacement] of SECRET_PATTERNS) {
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
