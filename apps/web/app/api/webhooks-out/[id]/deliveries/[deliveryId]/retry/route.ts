import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { parseBody } from "@/lib/validation";
import { retryDelivery } from "@/lib/webhooks/retry-delivery";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; deliveryId: string }> }
) {
  const parsed = await parseBody(req, z.object({}));
  if (!parsed.ok) return parsed.response;
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id, deliveryId } = await params;
  const out = await retryDelivery(ctx.workspace.id, id, deliveryId);
  if (out.ok) {
    await logAudit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: "webhook.delivery_retry",
      resource: "webhook_delivery",
      resourceId: deliveryId,
    });
  }
  return NextResponse.json(out, { status: out.ok ? 200 : 404 });
}
