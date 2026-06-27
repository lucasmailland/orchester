import "server-only";

/**
 * Returns true if the key's scopes grant `required` (e.g. "agents:read").
 *
 * Rules:
 *   - Empty scopes = legacy full-access key (backward-compat).
 *   - A "write" scope implies the matching "read" (agents:write → agents:read).
 */
export function hasScope(scopes: string[], required: string): boolean {
  if (scopes.length === 0) return true;
  if (scopes.includes(required)) return true;
  if (required.endsWith(":read")) {
    const writeEquiv = required.replace(/:read$/, ":write");
    if (scopes.includes(writeEquiv)) return true;
  }
  return false;
}
