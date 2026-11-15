import "server-only";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { getDb } from "@orchester/db";

type Db = Pick<ReturnType<typeof getDb>, "select">;
type Owned = PgTable & { id: PgColumn; workspaceId: PgColumn };

/**
 * Whether every id names a row of `table` in `workspaceId`.
 *
 * RLS is off in the single-tenant deploy, so an id a caller hands us (an agent
 * on a channel, a flow on a schedule) must be checked against the workspace
 * before it is stored: otherwise it points at another workspace's row.
 */
export async function ownedByWorkspace(
  db: Db,
  table: Owned,
  workspaceId: string,
  ids: readonly string[]
): Promise<boolean> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return true;
  const where: SQL | undefined = and(inArray(table.id, wanted), eq(table.workspaceId, workspaceId));
  const rows = await db.select({ id: table.id }).from(table).where(where);
  return rows.length === wanted.length;
}
