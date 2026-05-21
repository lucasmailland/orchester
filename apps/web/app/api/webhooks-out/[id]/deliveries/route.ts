import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

/** GET /api/webhooks-out/[id]/deliveries → últimas 25 entregas del webhook. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const rows = await db
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
        eq(schema.webhookDeliveries.workspaceId, ws.workspace.id)
      )
    )
    .orderBy(desc(schema.webhookDeliveries.createdAt))
    .limit(25);
  return NextResponse.json({ deliveries: rows });
}
