/**
 * Escaping helpers with no server dependencies, so flow validation can use
 * them in the browser as well as in the engine.
 */

/**
 * Escapes a value for embedding inside single quotes in NRQL. NRQL escapes with
 * a backslash, same as SQL string literals in most dialects. The caller writes
 * the quotes.
 */
export function nrqlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Odoo renders `description` and chatter bodies as HTML. Markdown reaches the
 * ticket as literal asterisks, and an unescaped `<` truncates the report at
 * the first angle bracket — which, in a stack trace, is common.
 */
export function htmlFromText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n|\r|\n/g, "<br/>");
}

/** `htmlFromText` plus quotes, safe inside attribute values too. */
export function htmlEscape(text: string): string {
  return htmlFromText(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
