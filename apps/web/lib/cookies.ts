// apps/web/lib/cookies.ts
//
// HMAC-SHA256 signed cookie values.
//
// We rely on `orch-active-workspace` to pick the tenant for downstream
// requests (resolver → membership → role checks). The cookie is set by
// our own POSTs and would normally be trustworthy, but it is also
// `httpOnly: false` (the switcher reads it from JS for hydration) and
// the value flows back unmodified on every request. A user who flips
// the cookie in their browser dev-tools could shove an arbitrary slug
// in, and while the membership check eventually catches it (403
// not_a_member) the resolver still does a DB lookup and the slug
// appears in logs as if it had been chosen legitimately.
//
// Signing the value gives us a constant-time pre-resolver reject: any
// cookie whose tag doesn't match our secret is treated as no cookie at
// all. This shrinks the attack surface to "valid signature from us",
// which membership then narrows further.
//
// Format: `<value>.<base64url(hmac_sha256(secret, value))>`. Base64url
// keeps the cookie short and Set-Cookie-safe (no padding, no `+`/`/`).
//
// IMPORTANT: this module runs in BOTH the Node runtime (route handlers)
// AND the Edge runtime (middleware.ts), so we use Web Crypto
// (`crypto.subtle.importKey` + `sign`) instead of `node:crypto`. The
// global `crypto` symbol is available in both runtimes.
//
// We intentionally omit the `server-only` marker for the same reason:
// `server-only` triggers a module replacement that imports a Node-only
// stub, which would break the Edge build. The module is still
// effectively server-only because the only callers are server-side
// (middleware + API routes); never import it from a client component.

const DEV_FALLBACK_SECRET = "dev-cookie-signing-secret-do-not-use-in-production";

/**
 * Resolve the HMAC secret. In production this MUST come from
 * `COOKIE_SIGNING_SECRET` — we throw on missing rather than silently
 * fall back to the dev value, because a single deploy with the dev
 * secret would let any browser holding a "dev-signed" cookie auth as
 * any tenant.
 *
 * In dev/test we fall back to a stable string (with a one-shot warning)
 * so local commands and tests don't require operators to set the env
 * before the harness boots.
 */
let warnedDevSecret = false;
function getSecret(): string {
  const env = process.env["COOKIE_SIGNING_SECRET"];
  if (env && env.length > 0) return env;
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("COOKIE_SIGNING_SECRET required in production");
  }
  if (!warnedDevSecret) {
    warnedDevSecret = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[cookies] COOKIE_SIGNING_SECRET is not set — using dev fallback. " +
        "Do NOT deploy without setting this in production."
    );
  }
  return DEV_FALLBACK_SECRET;
}

/**
 * Cache the imported key per secret. importKey is non-trivial in
 * SubtleCrypto and would otherwise be re-derived on every cookie
 * read/write — a hot path in the middleware. Keyed by secret so a
 * rotated env value naturally re-imports.
 */
const keyCache = new Map<string, Promise<CryptoKey>>();
function getKey(secret: string): Promise<CryptoKey> {
  let pending = keyCache.get(secret);
  if (pending) return pending;
  pending = crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  keyCache.set(secret, pending);
  return pending;
}

/**
 * Encode raw bytes as base64url (RFC 4648 §5): standard base64 minus
 * the trailing `=` padding and with `-_` instead of `+/`. Keeps the
 * cookie value safe to round-trip through Set-Cookie without quoting.
 */
function toBase64Url(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i] as number);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function computeTag(value: string): Promise<string> {
  const key = await getKey(getSecret());
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(sig);
}

/**
 * Constant-time string compare. Avoids reaching for `Buffer` (which
 * is Node-only — would break the Edge build); falls back to a manual
 * timing-safe XOR. Length mismatch returns false EARLY because the
 * loop bound depends on length: leaking that is unavoidable, so we
 * make it the only thing we leak.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Compute the HMAC tag for `value` and append it after a dot.
 * Returned string is what should be written to the cookie value.
 */
export async function signValue(value: string): Promise<string> {
  const tag = await computeTag(value);
  return `${value}.${tag}`;
}

/**
 * Verify a signed cookie value. Returns the original `value` on success,
 * or `null` if the signature is missing / wrong length / mismatched.
 * Callers should treat `null` as "no cookie" (do NOT 401 — the user
 * might just have a stale cookie from before signing was introduced;
 * downstream auth handles the missing-context case).
 *
 * Length-mismatch returns null EARLY (before the constant-time compare)
 * because both branches converge on the same return shape — the only
 * observable leak is "rejected"; the timing of that rejection still
 * varies by string length but does not vary by which character of the
 * tag is wrong, which is what timing-safe comparison buys us.
 */
export async function verifySigned(signed: string): Promise<string | null> {
  if (!signed) return null;
  const dot = signed.lastIndexOf(".");
  // Must have BOTH a value and a tag — strict separator check.
  if (dot <= 0 || dot >= signed.length - 1) return null;
  const value = signed.slice(0, dot);
  const mac = signed.slice(dot + 1);
  const expected = await computeTag(value);
  if (!constantTimeEqual(mac, expected)) return null;
  return value;
}
