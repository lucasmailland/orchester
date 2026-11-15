import "server-only";
import { getDb, schema } from "@orchester/db";
import { and, eq, sql } from "drizzle-orm";

export interface ChannelConfigPatch {
  color?: string;
  greeting?: string;
  title?: string;
  placeholder?: string;
  starters?: string[];
}

export async function updateChannelConfig(
  workspaceId: string,
  channelId: string,
  patch: ChannelConfigPatch
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    const rows = await tx
      .select({ config: schema.channels.config })
      .from(schema.channels)
      .where(and(eq(schema.channels.id, channelId), eq(schema.channels.workspaceId, workspaceId)))
      .limit(1);
    const existing = (rows[0]?.config ?? {}) as Record<string, unknown>;
    const merged = { ...existing, ...patch };
    await tx
      .update(schema.channels)
      .set({ config: merged, updatedAt: new Date() })
      .where(and(eq(schema.channels.id, channelId), eq(schema.channels.workspaceId, workspaceId)));
  });
}
