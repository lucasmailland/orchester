// apps/web/lib/feature-flags/check.ts
//
// Read-side of the per-workspace feature flag system. Backed by an
// in-process LRU-ish cache (see ./cache.ts). Returns `false` for any
// flag that isn't explicitly enabled so callers can wrap experimental
// features in `if (await isEnabled(ws, "foo"))` with safe defaults.
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { getCached, setCached } from "./cache";

export async function isEnabled(workspaceId: string, flagKey: string): Promise<boolean> {
  const cached = getCached(workspaceId, flagKey);
  if (cached !== undefined) return cached;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.featureFlags)
    .where(
      and(
        eq(schema.featureFlags.workspaceId, workspaceId),
        eq(schema.featureFlags.flagKey, flagKey)
      )
    )
    .limit(1);

  const enabled = rows[0]?.enabled ?? false;
  setCached(workspaceId, flagKey, enabled);
  return enabled;
}
