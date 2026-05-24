// apps/web/lib/feature-flags/check.ts
//
// Read-side of the per-workspace feature flag system. Backed by an
// in-process LRU-ish cache (see ./cache.ts). Returns `false` for any
// flag that isn't explicitly enabled so callers can wrap experimental
// features in `if (await isEnabled(ws, "foo"))` with safe defaults.
//
// Optional `tx?: WsDb` follows the project-wide pattern (see
// `lib/billing/quotas.ts`): when a caller is already inside a
// transaction with `app.workspace_id` SET LOCAL (e.g. the channels
// router), passing the same handle keeps the read on the same
// connection so FORCE RLS sees the GUC.
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema, type DbClient } from "@orchester/db";
import { getCached, setCached } from "./cache";

type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export async function isEnabled(workspaceId: string, flagKey: string, tx?: WsDb): Promise<boolean> {
  const cached = getCached(workspaceId, flagKey);
  if (cached !== undefined) return cached;

  const db = tx ?? getDb();
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
