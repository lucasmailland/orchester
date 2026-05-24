// apps/web/lib/gdpr/signed-url.ts
//
// HMAC-signed download tokens for GDPR export artefacts served by the
// `FilesystemAdapter`. We never want to persist a working download URL
// in the database (a DB dump should not also leak files), so the
// polling route regenerates a token per request via
// `regenerateSignedUrl` and the download route below verifies it.
//
// Token format (URL-safe):
//   base64url(JSON({ k: storageKey, e: expiryUnixMs })) "." HMAC-tag
//
// The HMAC tag is computed by `signValue` in `lib/cookies.ts`, which
// uses Web Crypto so it works in both Node and Edge. We reuse the same
// secret (`COOKIE_SIGNING_SECRET`) because (a) the same trust boundary
// applies (the server trusts itself), and (b) we already operate the
// rotation story for that secret. A leaked secret invalidates BOTH
// surfaces in one go — operationally simpler than carrying two
// independent secrets that can drift.
import "server-only";
import { signValue, verifySigned } from "../cookies";

interface TokenPayload {
  /** storage key (e.g. `<workspaceId>/<jobId>.zip`) */
  k: string;
  /** absolute expiry in unix ms */
  e: number;
}

function encode(payload: TokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decode(value: string): TokenPayload | null {
  try {
    const json = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as TokenPayload;
    if (typeof parsed?.k !== "string" || typeof parsed?.e !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build an HMAC-signed token encoding `{ storageKey, expiresAt }`.
 * Returns the opaque token string — the download URL is composed by
 * the caller (see `buildExportDownloadUrl`).
 */
export async function signExportToken(storageKey: string, expiresAt: Date): Promise<string> {
  return signValue(encode({ k: storageKey, e: expiresAt.getTime() }));
}

/**
 * Verify a token. Returns `{ storageKey }` on success or `null` on bad
 * signature / malformed payload / expired. Constant-time signature
 * compare comes from `verifySigned`.
 */
export async function verifyExportToken(token: string): Promise<{ storageKey: string } | null> {
  const inner = await verifySigned(token);
  if (!inner) return null;
  const payload = decode(inner);
  if (!payload) return null;
  if (payload.e < Date.now()) return null;
  // Defense in depth against path traversal — the storageKey should look
  // like `<workspaceId>/<jobId>.zip` and never contain `..` or absolute
  // paths. We reject anything else outright; the adapter that consumes
  // the key also flattens slashes when resolving the on-disk path, but
  // belt + suspenders.
  if (payload.k.includes("..") || payload.k.startsWith("/")) return null;
  return { storageKey: payload.k };
}

/**
 * Compose the full download URL for the filesystem adapter.
 * Resolves the public base from `NEXT_PUBLIC_APP_URL` and falls back
 * to the local dev port so dev/test invocations still produce a URL
 * shaped like the real one.
 */
export async function buildExportDownloadUrl(storageKey: string, expiresAt: Date): Promise<string> {
  const base = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3333";
  const token = await signExportToken(storageKey, expiresAt);
  return `${base.replace(/\/$/, "")}/api/exports/${encodeURIComponent(token)}`;
}
