import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { schema } from "@orchester/db";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { notifyWeeklyReport } from "./triggers";
import { safeLogError } from "@/lib/safe-log";

export async function runWeeklyReports(): Promise<void> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const workspaces = await withCrossTenantAdmin("weekly-report", async (tx) => {
      return tx
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.status, "active"));
    });

    for (const ws of workspaces) {
      try {
        const stats = await withCrossTenantAdmin("weekly-report-stats", async (tx) => {
          const rows = await tx
            .select({
              tokens: sql<number>`coalesce(sum(${schema.usageEvents.amount}), 0)`,
              conversations: sql<number>`coalesce(count(distinct ${schema.usageEvents.metadata}->>'conversationId'), 0)`,
            })
            .from(schema.usageEvents)
            .where(
              and(
                eq(schema.usageEvents.workspaceId, ws.id),
                eq(schema.usageEvents.kind, "agent_message"),
                gte(schema.usageEvents.createdAt, since)
              )
            );
          return rows[0] ?? { tokens: 0, conversations: 0 };
        });
        await notifyWeeklyReport(ws.id, {
          tokens: Number(stats.tokens),
          conversations: Number(stats.conversations),
        });
      } catch (e) {
        safeLogError(`[weekly-report] workspace ${ws.id} failed:`, e);
      }
    }
  } catch (e) {
    safeLogError("[weekly-report] runWeeklyReports failed:", e);
  }
}
