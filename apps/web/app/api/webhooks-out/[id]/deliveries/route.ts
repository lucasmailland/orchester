import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

/** GET /api/webhooks-out/[id]/deliveries → últimas 25 entregas del webhook. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  // webhook_delivery is FORCE RLS — needs workspace GUC on the connection.
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    return tx
      .select({
        id: schema.webhookDeliveries.id,
        event: schema.webhookDeliveries.event,
        status: schema.webhookDeliveries.status,
        responseStatus: schema.webhookDeliveries.responseStatus,
        error: schema.webhookDeliveries.error,
        attemptCount: schema.webhookDeliveries.attemptCount,
        deliveredAt: schema.webhookDeliveries.deliveredAt,
        createdAt: schema.webhookDeliveries.createdAt,
      })
      .from(schema.webhookDeliveries)
      .where(
        and(
          eq(schema.webhookDeliveries.webhookId, id),
          eq(schema.webhookDeliveries.workspaceId, ctx.workspace.id)
        )
      )
      .orderBy(desc(schema.webhookDeliveries.createdAt))
      .limit(25);
  });
  return NextResponse.json({ deliveries: rows });
}
