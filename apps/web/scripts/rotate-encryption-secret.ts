/**
 * rotate-encryption-secret.ts
 *
 * Llamado por scripts/rotate-encryption-secret.sh. Re-cifra todas las filas
 * con campos encriptados (api_key de providers, credentials de channels) del
 * secret VIEJO al NUEVO. Espera estas env vars:
 *
 *   OLD_ENCRYPTION_SECRET — el actual (lo que ya está en uso en la app)
 *   NEW_ENCRYPTION_SECRET — el que queremos como nuevo master key
 *   DATABASE_URL          — donde están las filas
 */
/* eslint-disable no-console */

import crypto from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function decrypt(encoded: string, secret: string): string {
  const key = Buffer.from(secret, "hex");
  const [ivB64, tagB64, ctB64] = encoded.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("bad ciphertext");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

function encrypt(plaintext: string, secret: string): string {
  const key = Buffer.from(secret, "hex");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

async function main(): Promise<void> {
  const oldSecret = process.env["OLD_ENCRYPTION_SECRET"];
  const newSecret = process.env["NEW_ENCRYPTION_SECRET"];
  const dbUrl = process.env["DATABASE_URL"];
  if (!oldSecret || !newSecret || !dbUrl) {
    throw new Error("OLD_ENCRYPTION_SECRET, NEW_ENCRYPTION_SECRET, DATABASE_URL required");
  }
  if (oldSecret.length !== 64 || newSecret.length !== 64) {
    throw new Error("Both secrets must be 64-char hex strings");
  }

  const sql = postgres(dbUrl, { max: 1 });
  const db = drizzle(sql);

  console.log("[rotate] Re-encrypting ai_provider.api_key …");
  const providers = await db.execute<{ id: string; api_key: string }>(
    sql`SELECT id, api_key FROM ai_provider`.values as unknown as never
  );
  // Drizzle execute con tagged template:
  const provRows = (await sql`SELECT id, api_key FROM ai_provider`) as Array<{
    id: string;
    api_key: string;
  }>;
  let updated = 0;
  for (const r of provRows) {
    try {
      const plaintext = decrypt(r.api_key, oldSecret);
      const reencrypted = encrypt(plaintext, newSecret);
      await sql`UPDATE ai_provider SET api_key = ${reencrypted} WHERE id = ${r.id}`;
      updated++;
    } catch (e) {
      console.error(`[rotate] provider ${r.id} failed:`, (e as Error).message);
    }
  }
  console.log(`[rotate] ai_provider: ${updated}/${provRows.length} re-encrypted`);

  console.log("[rotate] Re-encrypting channel.credentials_encrypted …");
  const chRows = (await sql`SELECT id, credentials_encrypted FROM channel WHERE credentials_encrypted IS NOT NULL`) as Array<{
    id: string;
    credentials_encrypted: string;
  }>;
  let chUpdated = 0;
  for (const r of chRows) {
    try {
      const plaintext = decrypt(r.credentials_encrypted, oldSecret);
      const reencrypted = encrypt(plaintext, newSecret);
      await sql`UPDATE channel SET credentials_encrypted = ${reencrypted} WHERE id = ${r.id}`;
      chUpdated++;
    } catch (e) {
      console.error(`[rotate] channel ${r.id} failed:`, (e as Error).message);
    }
  }
  console.log(`[rotate] channel: ${chUpdated}/${chRows.length} re-encrypted`);

  await sql.end();
  console.log("[rotate] Done.");
  // Suppress unused
  void providers;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
