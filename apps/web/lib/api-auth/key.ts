import "server-only";
import crypto from "node:crypto";
import { getDb, schema } from "@orchester/db";
import { eq, sql } from "drizzle-orm";

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

/**
 * Validate Bearer header, return workspace context or null.
 *
 * Tenant context: this is a legitimately cross-tenant lookup (we don't
 * know the workspace until the hash matches a row). `api_key` is RLS
 * FORCED, so we must opt into the cross-tenant bypass for the SELECT
 * via the `app.cross_tenant_admin` GUC. The `lastUsedAt` UPDATE then
 * runs with the resolved workspace context set, satisfying RLS for the
 * mutating path as well.
 */
export async function authenticateApiKey(
  authorizationHeader: string | null
): Promise<{ workspaceId: string; keyId: string; scopes: string[] } | null> {
  if (!authorizationHeader) return null;
  const m = /^Bearer\s+(ok_live_[A-Za-z0-9_\-]+)$/.exec(authorizationHeader.trim());
  if (!m) return null;
  const plain = m[1]!;
  const hashed = hashApiKey(plain);
  const db = getDb();
  const row = await db.transaction(async (tx) => {
    // Cross-tenant lookup: we don't know the workspace yet. The bypass
    // GUC is LOCAL to this txn so it cannot leak across requests.
    await tx.execute(sql`SELECT set_config('app.cross_tenant_admin', 'true', true)`);
    const rows = await tx
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.hashedKey, hashed))
      .limit(1);
    return rows[0] ?? null;
  });
  if (!row || row.revokedAt) return null;
  // Fire-and-forget lastUsedAt bump. Runs in its own txn with the
  // resolved workspace_id so RLS allows the UPDATE without a bypass.
  void db
    .transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.workspace_id', ${row.workspaceId}, true)`);
      await tx
        .update(schema.apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.apiKeys.id, row.id));
    })
    .catch(() => {});
  return {
    workspaceId: row.workspaceId,
    keyId: row.id,
    scopes: row.scopes ?? [],
  };
}
