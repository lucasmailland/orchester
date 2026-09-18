/**
 * What an API key is allowed to do.
 *
 * Until now a key could only be created with a name, so every key got the same
 * default and could write every agent and every flow in the workspace. The
 * machinery to restrict it already existed; there was no way to reach it.
 *
 * A scope is `<domain>:<access>`. Writing a domain implies reading it — a key
 * that can rewrite a flow can obviously see it, and pairing them by hand is a
 * footgun with no upside.
 */

/** The areas a key can be given access to, in the order the form shows them. */
export const SCOPE_DOMAINS = [
  "agents",
  "flows",
  "conversations",
  "knowledge",
  "employees",
  "memory",
] as const;

export type ScopeDomain = (typeof SCOPE_DOMAINS)[number];
export type ScopeAccess = "read" | "write";

/** Every scope a key may be given, e.g. `flows:write`. */
export const ALL_SCOPES: string[] = SCOPE_DOMAINS.flatMap((domain) => [
  `${domain}:read`,
  `${domain}:write`,
]);

const SCOPE_SET = new Set(ALL_SCOPES);

export function isKnownScope(scope: string): boolean {
  return SCOPE_SET.has(scope);
}

/**
 * Legacy scopes that predate this vocabulary and are still honoured:
 *
 *   - `readonly` denied every write, whatever else it carried.
 *   - `write` allowed every write.
 *
 * Neither is offered when creating a key. They are read, never written.
 */
const LEGACY_READONLY = "readonly";
const LEGACY_WRITE = "write";

/**
 * The scopes a key created before this vocabulary carried by default. A key
 * holding exactly these was, in practice, unrestricted, because reads were
 * never checked at all.
 */
export const PRE_SCOPES_DEFAULT = ["agents:read", "agents:write", "flows:read", "flows:write"];

/**
 * Whether `scopes` permit `access` on `domain`.
 *
 * An empty list means full access. That is how keys were stored before this
 * existed, and it is why the check is written as an allowlist rather than a
 * blocklist: a rule that fails open is not a rule. It is kept only until the
 * migration that gives every existing key explicit scopes has run everywhere,
 * and `apiKeyScopesSchema` refuses to create a new key without any.
 */
export function scopesAllow(scopes: string[], domain: string, access: ScopeAccess): boolean {
  if (!Array.isArray(scopes) || scopes.length === 0) return true;
  if (access === "write" && scopes.includes(LEGACY_READONLY)) return false;
  if (scopes.includes(LEGACY_WRITE)) return true;
  if (scopes.includes(`${domain}:${access}`)) return true;
  // Writing a domain implies reading it.
  return access === "read" && scopes.includes(`${domain}:write`);
}

/**
 * Human-readable reason a call was refused, for the error the caller sees.
 * Saying which scope is missing turns "forbidden" into something actionable.
 */
export function missingScopeMessage(domain: string, access: ScopeAccess): string {
  return `This API key does not have the "${domain}:${access}" permission.`;
}
