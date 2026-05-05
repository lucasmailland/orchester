import "server-only";
import crypto from "node:crypto";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";

/** Generate a new API key. Returns plain (shown once), hashed (stored), prefix (display). */
export function generateApiKey(): { plain: string; hashed: string; prefix: string } {
  const random = crypto.randomBytes(24).toString("base64url");
  const plain = `ok_live_${random}`;
  const hashed = crypto.createHash("sha256").update(plain).digest("hex");
  const prefix = plain.slice(0, 12) + "…" + plain.slice(-4);
  return { plain, hashed, prefix };
}

export function hashApiKey(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

/** Validate Bearer header, return workspace context or null. */
export async function authenticateApiKey(
  authorizationHeader: string | null
): Promise<{ workspaceId: string; keyId: string; scopes: string[] } | null> {
  if (!authorizationHeader) return null;
  const m = /^Bearer\s+(ok_live_[A-Za-z0-9_\-]+)$/.exec(authorizationHeader.trim());
  if (!m) return null;
  const plain = m[1]!;
  const hashed = hashApiKey(plain);
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.hashedKey, hashed))
    .limit(1);
  const row = rows[0];
  if (!row || row.revokedAt) return null;
  db.update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, row.id))
    .catch(() => {});
  return {
    workspaceId: row.workspaceId,
    keyId: row.id,
    scopes: row.scopes ?? [],
  };
}
