/**
 * Open-redirect guard for login `?return=` paths.
 *
 * Rules:
 *  - Must be a non-empty string.
 *  - Must start with "/" (relative).
 *  - Must NOT start with "//" (protocol-relative URL).
 *  - Must NOT contain "://" after the first character (absolute URL).
 *  - Must NOT contain a literal "\\" (Windows-style traversal that some
 *    parsers normalize into protocol slashes).
 *
 * Returns the path unchanged when safe, or `null` when it should be rejected.
 * Always fall back to a known-good route (e.g. `/${locale}`) on null.
 */
export function safeReturnPath(input: string | null | undefined): string | null {
  if (!input || typeof input !== "string") return null;
  if (input.length < 1 || input.length > 512) return null;
  if (!input.startsWith("/")) return null;
  if (input.startsWith("//")) return null;
  if (input.includes("\\")) return null;
  // Reject any scheme-like sequence (http://, javascript:, data:, etc.).
  // After the leading "/", we should never see "://".
  if (input.slice(1).includes("://")) return null;
  // Reject lone "javascript:" or "data:" etc. just in case the leading "/"
  // is followed by a colon.
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(input)) return null;
  return input;
}
