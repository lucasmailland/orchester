/**
 * reencrypt-credentials.ts
 *
 * Re-encrypts every stored secret to the CURRENT key version after a key
 * rotation (see apps/web/lib/encryption.ts for the rotation procedure and the
 * ENCRYPTION_SECRET / ENCRYPTION_KEYS env contract — this script mirrors that
 * keyring logic intentionally, because lib/encryption.ts is "server-only" and
 * cannot be imported from a standalone Node script).
 *
 * Tables / columns covered:
 *   - ai_provider.api_key
 *   - channel.credentials_encrypted        (nullable)
 *   - workspace_integration.config_encrypted
 *
 * Behavior:
 *   - Idempotent: rows already at the current version are skipped.
 *   - Transaction-safe: each table is updated inside a single DB transaction,
 *     so a failure rolls back that table's changes (no half-migrated table).
 *   - Dry-run: pass --dry-run (or set DRY_RUN=1) to report what WOULD change
 *     without writing anything.
 *
 * Env vars:
 *   DATABASE_URL        — Postgres connection string (required)
 *   ENCRYPTION_SECRET   — primary key, registered as version 1 (required)
 *   ENCRYPTION_KEYS     — optional extra keys for rotation (see lib/encryption.ts)
 *
 * Usage:
 *   tsx apps/web/scripts/reencrypt-credentials.ts --dry-run
 *   tsx apps/web/scripts/reencrypt-credentials.ts
 *
 * NOTE: DB access here is modeled on apps/web/scripts/rotate-encryption-secret.ts
 * (raw `postgres` + tagged-template SQL). Table and column names were taken from
 * packages/db/src/schema (core.ts, ai-providers.ts, integrations.ts). If the
 * schema changes, update the SQL below accordingly.
 */
/* eslint-disable no-console */

import crypto from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const PRIMARY_VERSION = 1;
const VERSION_PREFIX_RE = /^v(\d+):/;

/* ───────────────────────── keyring (mirrors lib/encryption.ts) ───────────────────────── */

function deriveKey(secret: string): Buffer {
  if (secret.length !== 64) {
    throw new Error(
      "Encryption key must be a 32-byte hex string (64 chars). Got: " + secret.length
    );
  }
  return Buffer.from(secret, "hex");
}

function parseExtraKeys(raw: string): Map<number, string> {
  const out = new Map<number, string>();
  const trimmed = raw.trim();
  if (!trimmed) return out;

  if (trimmed.startsWith("{")) {
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

interface Keyring {
  keys: Map<number, Buffer>;
  current: number;
}

function buildKeyring(): Keyring {
  const secret = process.env["ENCRYPTION_SECRET"];
  if (!secret) {
    throw new Error(
      "ENCRYPTION_SECRET env var is required. Generate one with: openssl rand -hex 32"
    );
  }
  const keys = new Map<number, Buffer>();
  keys.set(PRIMARY_VERSION, deriveKey(secret));

  const extraRaw = process.env["ENCRYPTION_KEYS"];
  if (extraRaw) {
    for (const [version, hex] of parseExtraKeys(extraRaw)) {
      const key = deriveKey(hex);
      const existing = keys.get(version);
      if (existing && !existing.equals(key)) {
        throw new Error(
          `ENCRYPTION_KEYS version ${version} conflicts with the key already ` +
            `registered for that version.`
        );
      }
      keys.set(version, key);
    }
  }
  return { keys, current: Math.max(...keys.keys()) };
}

function ciphertextVersion(encoded: string): number {
  const match = VERSION_PREFIX_RE.exec(encoded);
  return match ? Number(match[1]) : PRIMARY_VERSION;
}

function decryptWith(ring: Keyring, encoded: string): string {
  const match = VERSION_PREFIX_RE.exec(encoded);
  const version = match ? Number(match[1]) : PRIMARY_VERSION;
  const key = ring.keys.get(version);
  if (!key) {
    throw new Error(`No key registered for version ${version}`);
  }
  const body = match ? encoded.slice(match[0].length) : encoded;
  const [ivB64, tagB64, ctB64] = body.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Invalid ciphertext format");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

function encryptCurrent(ring: Keyring, plaintext: string): string {
  const key = ring.keys.get(ring.current);
  if (!key) throw new Error(`No key registered for current version ${ring.current}`);
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

/* ───────────────────────── migration ───────────────────────── */

type Sql = ReturnType<typeof postgres>;

interface TableSpec {
  table: string;
  column: string;
  /** when true, only select rows where the column is non-null */
  notNull?: boolean;
}

const TABLES: TableSpec[] = [
  { table: "ai_provider", column: "api_key" },
  { table: "channel", column: "credentials_encrypted", notNull: true },
  { table: "workspace_integration", column: "config_encrypted" },
];

interface Stats {
  total: number;
  reencrypted: number;
  skipped: number;
  failed: number;
}

async function migrateTable(
  sql: Sql,
  ring: Keyring,
  spec: TableSpec,
  dryRun: boolean
): Promise<Stats> {
  const stats: Stats = { total: 0, reencrypted: 0, skipped: 0, failed: 0 };

  // sql(identifier) safely quotes table/column identifiers.
  const rows = (await sql`
    SELECT id, ${sql(spec.column)} AS value
    FROM ${sql(spec.table)}
    ${spec.notNull ? sql`WHERE ${sql(spec.column)} IS NOT NULL` : sql``}
  `) as Array<{ id: string; value: string | null }>;

  stats.total = rows.length;

  // Pre-compute the new ciphertext for every row that needs migration.
  const updates: Array<{ id: string; value: string }> = [];
  for (const r of rows) {
    if (!r.value) {
      stats.skipped++;
      continue;
    }
    if (ciphertextVersion(r.value) === ring.current) {
      // Already at the current version → idempotent skip.
      stats.skipped++;
      continue;
    }
    try {
      const plaintext = decryptWith(ring, r.value);
      const reencrypted = encryptCurrent(ring, plaintext);
      updates.push({ id: r.id, value: reencrypted });
    } catch (e) {
      stats.failed++;
      console.error(
        `[reencrypt] ${spec.table} ${r.id} failed to decrypt: ${(e as Error).message}`
      );
    }
  }

  if (dryRun) {
    stats.reencrypted = updates.length; // would-be count
    return stats;
  }

  if (updates.length > 0) {
    // Transaction-safe: all updates for this table commit or roll back together.
    await sql.begin(async (tx) => {
      for (const u of updates) {
        await tx`
          UPDATE ${tx(spec.table)}
          SET ${tx(spec.column)} = ${u.value}
          WHERE id = ${u.id}
        `;
      }
    });
  }
  stats.reencrypted = updates.length;
  return stats;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run") || process.env["DRY_RUN"] === "1";
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) throw new Error("DATABASE_URL is required");

  const ring = buildKeyring();
  console.log(
    `[reencrypt] current key version = v${ring.current}; ` +
      `registered versions = [${[...ring.keys.keys()].sort((a, b) => a - b).join(", ")}]`
  );
  if (dryRun) console.log("[reencrypt] DRY RUN — no writes will be made.");

  const sql = postgres(dbUrl, { max: 1 });
  // drizzle instance is created for parity with the rest of the codebase; the
  // raw tagged-template `sql` is used directly for these maintenance queries.
  const db = drizzle(sql);
  void db;

  try {
    for (const spec of TABLES) {
      const s = await migrateTable(sql, ring, spec, dryRun);
      console.log(
        `[reencrypt] ${spec.table}.${spec.column}: ` +
          `${s.reencrypted}${dryRun ? " would be" : ""} re-encrypted, ` +
          `${s.skipped} skipped (already current/empty), ` +
          `${s.failed} failed, ${s.total} total`
      );
    }
  } finally {
    await sql.end();
  }

  console.log(`[reencrypt] Done${dryRun ? " (dry run)" : ""}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
