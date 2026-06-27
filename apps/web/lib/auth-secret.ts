// SEC-6: resolve the auth secret from BETTER_AUTH_SECRET (canonical) or
// AUTH_SECRET (alias used in some .env files). In production a missing secret
// is fatal — a hardcoded fallback would let anyone forge a session. In
// dev/test we fall back with a one-shot warning. Mirrors lib/cookies.ts.

let warnedDevAuthSecret = false;

export function resolveAuthSecret(): string {
  const secret = process.env["BETTER_AUTH_SECRET"] ?? process.env["AUTH_SECRET"];
  if (secret) return secret;
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("BETTER_AUTH_SECRET (or AUTH_SECRET) required in production");
  }
  if (!warnedDevAuthSecret) {
    warnedDevAuthSecret = true;
    console.warn("[auth] BETTER_AUTH_SECRET unset — using dev fallback (NEVER in production)");
  }
  return "dev-secret-change-in-production";
}
