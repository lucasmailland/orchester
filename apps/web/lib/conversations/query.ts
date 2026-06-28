import "server-only";
import { getDb, schema } from "@orchester/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

export interface SearchConversationsOpts {
  search?: string | null;
  status?: "open" | "closed" | "escalated" | null;
  limit?: number;
  offset?: number;
}

export async function searchConversations(workspaceId: string, opts: SearchConversationsOpts = {}) {
  const { search, status, limit = 50, offset = 0 } = opts;
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    const conds = [eq(schema.conversations.workspaceId, workspaceId)];
    if (status) conds.push(eq(schema.conversations.status, status));
    if (search) {
      conds.push(
        or(
          ilike(schema.conversations.summary, `%${search}%`),
          ilike(schema.conversations.customerName, `%${search}%`),
          ilike(schema.conversations.customerEmail, `%${search}%`)
        )!
      );
    }
    return tx
      .select({
        id: schema.conversations.id,
        status: schema.conversations.status,
        customerName: schema.conversations.customerName,
        customerEmail: schema.conversations.customerEmail,
        summary: schema.conversations.summary,
        startedAt: schema.conversations.startedAt,
      })
      .from(schema.conversations)
      .where(and(...conds))
      .orderBy(desc(schema.conversations.startedAt))
      .limit(limit)
      .offset(offset);
  });
}
