import "server-only";
import crypto from "node:crypto";

/**
 * AES-256-GCM symmetric encryption with a versioned keyring.
 *
 * ## Ciphertext formats
 *
 * - **Versioned (current)**: `v<N>:<iv>:<tag>:<ct>` where N is the integer key
 *   version and iv/tag/ct are base64. `encrypt()` always writes this format
 *   using the current (highest) key version.
 * - **Legacy (read-only, backward-compat)**: `<iv>:<tag>:<ct>` (base64 triple,
 *   no version prefix). This is the format written before key versioning
 *   existed. `decrypt()` still reads it, using the primary key — which is
 *   version 1 derived from `ENCRYPTION_SECRET`, i.e. the exact same key that
 *   originally produced that data. Existing DB rows therefore keep decrypting.
 *
 * ## Env vars
 *
 * - `ENCRYPTION_SECRET` (required): 32-byte hex string (64 chars). This is the
 *   primary key and is always registered as **version 1**. Same var name and
 *   same key derivation as before, so existing deployments and existing
 *   ciphertext are unaffected.
 * - `ENCRYPTION_KEYS` (optional): additional keys for rotation, so that old
 *   ciphertext tagged with an older version still decrypts after the primary
 *   key changes. Two accepted formats:
 *     1. JSON object mapping version -> hex key, e.g.
 *        `{"1":"<old hex>","2":"<new hex>"}`
 *     2. Comma-separated `version:hexkey` pairs, e.g.
 *        `1:<old hex>,2:<new hex>`
 *   Each key must be a 32-byte hex string (64 chars). If a version also appears
 *   via `ENCRYPTION_SECRET` (version 1), the `ENCRYPTION_KEYS` entry for that
 *   version must match (consistency check). The **highest** registered version
 *   becomes the current write key.
 *
 * ## Key rotation procedure
 *
 * 1. Generate a new key with: openssl rand -hex 32
 * 2. Add it to `ENCRYPTION_KEYS` at a version higher than any existing one,
 *    AND keep the old primary key registered (either still in `ENCRYPTION_SECRET`
 *    as v1, or moved into `ENCRYPTION_KEYS` at its version). Example going from
 *    v1 to v2:
 *      - `ENCRYPTION_SECRET=<old v1 hex>`   (keeps v1 available for decrypt)
 *      - `ENCRYPTION_KEYS=2:<new v2 hex>`   (v2 becomes the current write key)
 * 3. Deploy. New writes now use v2; old v1 ciphertext still decrypts.
 * 4. Run the re-encrypt script to migrate all stored secrets to the current
 *    version: `tsx apps/web/scripts/reencrypt-credentials.ts` (use `--dry-run`
 *    first). See that file for details.
 * 5. Once everything is at v2, drop the old key: remove the v1 entry, keeping
 *    the live key registered at the highest version. The only hard requirement
 *    is that the highest registered version is the current write key, and that
 *    every version still present in the DB has its key registered.
 *
 * Note: `ENCRYPTION_SECRET` is always pinned to version 1. To fully retire v1
 * you keep the live key in `ENCRYPTION_KEYS` at its real version; only point
 * `ENCRYPTION_SECRET` at a different key once no v1 ciphertext remains.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const PRIMARY_VERSION = 1;
const VERSION_PREFIX_RE = /^v(\d+):/;

/** Validate + decode a 32-byte hex secret into a key buffer. */
function deriveKey(secret: string): Buffer {
  if (secret.length !== 64) {
    throw new Error(
      "ENCRYPTION_SECRET must be a 32-byte hex string (64 chars). Got: " + secret.length
    );
  }
  return Buffer.from(secret, "hex");
}

interface Keyring {
  /** version -> 32-byte key */
  keys: Map<number, Buffer>;
  /** highest registered version (the current write version) */
  current: number;
}

let cachedKeyring: Keyring | null = null;

/** Parse the optional ENCRYPTION_KEYS env into a version->hex map. */
function parseExtraKeys(raw: string): Map<number, string> {
  const out = new Map<number, string>();
  const trimmed = raw.trim();
  if (!trimmed) return out;

  if (trimmed.startsWith("{")) {
    // JSON object: { "1": "<hex>", "2": "<hex>" }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      throw new Error("ENCRYPTION_KEYS is not valid JSON");
    }
    for (const [k, v] of Object.entries(parsed)) {
      const version = Number(k);
      if (!Number.isInteger(version) || version < 1) {
        throw new Error(`ENCRYPTION_KEYS has invalid version: ${k}`);
      }
      if (typeof v !== "string") {
        throw new Error(`ENCRYPTION_KEYS version ${k} must map to a hex string`);
      }
      out.set(version, v);
    }
    return out;
  }

  // Comma-separated "version:hexkey" pairs.
  for (const pair of trimmed.split(",")) {
    const part = pair.trim();
    if (!part) continue;
    const idx = part.indexOf(":");
    if (idx === -1) {
      throw new Error(`ENCRYPTION_KEYS entry "${part}" must be "version:hexkey"`);
    }
    const version = Number(part.slice(0, idx).trim());
    const hex = part.slice(idx + 1).trim();
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`ENCRYPTION_KEYS has invalid version in "${part}"`);
    }
    out.set(version, hex);
  }
  return out;
}

/** Build (and cache) the keyring from env. Throws if no primary secret. */
function getKeyring(): Keyring {
  if (cachedKeyring) return cachedKeyring;

  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_SECRET env var is required. Generate one with: openssl rand -hex 32"
    );
  }

  const keys = new Map<number, Buffer>();
  // ENCRYPTION_SECRET is always version 1 (preserves legacy key derivation).
  keys.set(PRIMARY_VERSION, deriveKey(secret));

  const extraRaw = process.env.ENCRYPTION_KEYS;
  if (extraRaw) {
    for (const [version, hex] of parseExtraKeys(extraRaw)) {
      const key = deriveKey(hex);
      const existing = keys.get(version);
      if (existing && !existing.equals(key)) {
        throw new Error(
          `ENCRYPTION_KEYS version ${version} conflicts with the key already ` +
            `registered for that version (ENCRYPTION_SECRET pins version ${PRIMARY_VERSION}).`
        );
      }
      keys.set(version, key);
    }
  }

  const current = Math.max(...keys.keys());
  cachedKeyring = { keys, current };
  return cachedKeyring;
}

/** Look up a key by version, throwing a clear error if it isn't registered. */
function keyForVersion(version: number): Buffer {
  const ring = getKeyring();
  const key = ring.keys.get(version);
  if (!key) {
    throw new Error(
      `No encryption key registered for version ${version}. ` +
        `Add it via ENCRYPTION_KEYS (e.g. "${version}:<hexkey>").`
    );
  }
  return key;
}

/**
 * Encrypt plaintext to "v<N>:<iv>:<tag>:<ct>" using the current key version.
 * (Components are base64; the version prefix is plain text.)
 */
export function encrypt(plaintext: string): string {
  const ring = getKeyring();
  const key = keyForVersion(ring.current);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    `v${ring.current}`,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a ciphertext string — throws on tamper.
 *
 * Accepts both the versioned format `v<N>:<iv>:<tag>:<ct>` (key chosen by the
 * embedded version) and the legacy unversioned format `<iv>:<tag>:<ct>`
 * (decrypted with the primary/version-1 key for backward compatibility).
 */
export function decrypt(encoded: string): string {
  const match = VERSION_PREFIX_RE.exec(encoded);

  let key: Buffer;
  let ivB64: string | undefined;
  let tagB64: string | undefined;
  let ctB64: string | undefined;

  if (match) {
    const version = Number(match[1]);
    key = keyForVersion(version);
    // Strip the "v<N>:" prefix, then split the remaining iv:tag:ct.
    [ivB64, tagB64, ctB64] = encoded.slice(match[0].length).split(":");
  } else {
    // Legacy unversioned ciphertext: decrypt with the primary (v1) key.
    key = keyForVersion(PRIMARY_VERSION);
    [ivB64, tagB64, ctB64] = encoded.split(":");
  }

  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("Invalid ciphertext format");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * Returns the version of a ciphertext: the embedded version for versioned
 * strings, or `1` for legacy unversioned strings (which are v1 by definition).
 */
export function ciphertextVersion(encoded: string): number {
  const match = VERSION_PREFIX_RE.exec(encoded);
  return match ? Number(match[1]) : PRIMARY_VERSION;
}

/** The current (highest) key version used for new writes. */
export function currentKeyVersion(): number {
  return getKeyring().current;
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}
