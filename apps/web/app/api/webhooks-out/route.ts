import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import crypto from "node:crypto";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { apiError } from "@/lib/api-response";
import { BlockedDestinationError } from "@/lib/net-guard";
import { logAudit } from "@/lib/audit";

const createWebhookSchema = z.object({
  url: z.string().optional(),
  events: z.array(z.string()).optional(),
});

export async function GET() {
  // Managing outbound webhooks is admin-only; the signing secret lets whoever
  // holds it forge events to the receiver, so only admins see it.
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.outboundWebhooks)
    .where(eq(schema.outboundWebhooks.workspaceId, ctx.workspace.id))
    .orderBy(desc(schema.outboundWebhooks.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, createWebhookSchema);
  if (!parsed.ok) return parsed.response;
  const url = String(parsed.data.url ?? "").trim();
  const events = parsed.data.events ?? [];
  try {
    const { assertPublicUrl } = await import("@/lib/net-guard");
    assertPublicUrl(url);
  } catch (e) {
    return apiError(
      e instanceof BlockedDestinationError ? "Endpoint not allowed" : "Invalid URL",
      400
    );
  }
  const db = getDb();
  const inserted = await db
    .insert(schema.outboundWebhooks)
    .values({
      id: createId(),
      workspaceId: ctx.workspace.id,
      url,
      secret: crypto.randomBytes(32).toString("hex"),
      events,
    })
    .returning();
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "webhook.create",
    resource: "outbound_webhook",
    resourceId: inserted[0]?.id,
    after: { url, events },
  });
  return NextResponse.json(inserted[0]!, { status: 201 });
}
