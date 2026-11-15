// SEC-6: resolve the auth secret from BETTER_AUTH_SECRET (canonical) or
// AUTH_SECRET (alias used in some .env files). In production a missing secret
// is fatal — a hardcoded fallback would let anyone forge a session. In
// dev/test we fall back with a one-shot warning. Mirrors lib/cookies.ts.

let warnedDevAuthSecret = false;

/**
 * In production, refuse a secret that is a placeholder from .env.example or
 * the docs (anyone can read them, so anyone could sign with it) or too short to
 * be random.
 */
export function assertUsableSecret(name: string, secret: string): void {
  if (process.env["NODE_ENV"] !== "production") return;
  if (process.env["NEXT_PHASE"] === "phase-production-build") return;
  const placeholder = /generate-with|change-?me|replace-?me|your[-_ ]?secret|dev-secret|example/i;
  if (secret.length < 16 || placeholder.test(secret)) {
    throw new Error(
      `${name} looks like a placeholder or is too short. Generate one: openssl rand -base64 32`
    );
  }
}

export function resolveAuthSecret(): string {
  const secret = process.env["BETTER_AUTH_SECRET"] ?? process.env["AUTH_SECRET"];
  if (secret) {
    assertUsableSecret("BETTER_AUTH_SECRET", secret);
    return secret;
  }
  // `next build` imports lib/auth.ts while collecting page data, with
  // NODE_ENV=production and no runtime secrets (deploy/Dockerfile). Nothing
  // is signed during the build, so only a running server must have the secret.
  const building = process.env["NEXT_PHASE"] === "phase-production-build";
  if (process.env["NODE_ENV"] === "production" && !building) {
    throw new Error("BETTER_AUTH_SECRET (or AUTH_SECRET) required in production");
  }
  if (!warnedDevAuthSecret) {
    warnedDevAuthSecret = true;
    console.warn("[auth] BETTER_AUTH_SECRET unset — using dev fallback (NEVER in production)");
  }
  return "dev-secret-change-in-production";
}
