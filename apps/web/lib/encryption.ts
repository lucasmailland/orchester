import "server-only";
import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_SECRET env var is required. Generate one with: openssl rand -hex 32"
    );
  }
  if (secret.length !== 64) {
    throw new Error(
      "ENCRYPTION_SECRET must be a 32-byte hex string (64 chars). Got: " + secret.length
    );
  }
  return Buffer.from(secret, "hex");
}

/** Encrypt plaintext to "iv:authTag:ciphertext" base64 triple. */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/** Decrypt "iv:authTag:ciphertext" — throws on tamper. */
export function decrypt(encoded: string): string {
  const key = getKey();
  const [ivB64, tagB64, ctB64] = encoded.split(":");
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

export function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}
