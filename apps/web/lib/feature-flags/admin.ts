// apps/web/lib/feature-flags/admin.ts
//
// Write-side of the per-workspace feature flag system. `setFlag` is the
// only mutation entry point and is responsible for keeping the cache in
// sync via `invalidateFlag`. `listFlags` is read-only and bypasses the
// per-key cache (admin UIs need the full set).
//
// Optional `tx?: WsDb` follows the project-wide pattern (see
// `lib/billing/quotas.ts`).
import "server-only";
import { and, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema, type DbClient } from "@orchester/db";
import { invalidateFlag } from "./cache";

type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export async function setFlag(
  workspaceId: string,
  flagKey: string,
  enabled: boolean,
  opts: { userId: string },
  tx?: WsDb
): Promise<void> {
  const db = tx ?? getDb();
  const existing = await db
    .select()
    .from(schema.featureFlags)
    .where(
      and(
        eq(schema.featureFlags.workspaceId, workspaceId),
        eq(schema.featureFlags.flagKey, flagKey)
      )
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.featureFlags)
      .set({ enabled, setByUserId: opts.userId, updatedAt: new Date() })
      .where(eq(schema.featureFlags.id, existing[0].id));
  } else {
    await db.insert(schema.featureFlags).values({
      id: createId(),
      workspaceId,
      flagKey,
      enabled,
      setByUserId: opts.userId,
      rolledOutAt: enabled ? new Date() : null,
    });
  }
  invalidateFlag(workspaceId, flagKey);
}

export async function listFlags(workspaceId: string, tx?: WsDb) {
  const db = tx ?? getDb();
  return db
    .select()
    .from(schema.featureFlags)
    .where(eq(schema.featureFlags.workspaceId, workspaceId));
}
