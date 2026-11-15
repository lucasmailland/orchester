/**
 * Text from a tool, a remote system or the model's own earlier output reaches
 * the model inside `<untrusted_context>`. The text must not be able to close
 * that block early and continue as instructions, so any tag of that name in it
 * is neutralized.
 */
export function neutralizeUntrusted(text: string): string {
  return text.replace(/<(\/?\s*)untrusted_context/gi, "&lt;$1untrusted_context");
}

/** A tool error often carries a remote body (GitLab, Odoo, Postgres): untrusted too. */
export function untrustedToolError(error: string): string {
  return `Error: <untrusted_context source="tool_error">\n${neutralizeUntrusted(error)}\n</untrusted_context>`;
}
