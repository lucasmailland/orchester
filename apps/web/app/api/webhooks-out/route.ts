import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import crypto from "node:crypto";
import { schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

const createWebhookSchema = z.object({
  url: z.string().optional(),
  events: z.array(z.string()).optional(),
});

export async function GET() {
  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      return tx
        .select()
        .from(schema.outboundWebhooks)
        .where(eq(schema.outboundWebhooks.workspaceId, ctx.workspace.id))
        .orderBy(desc(schema.outboundWebhooks.createdAt));
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const parsed = await parseBody(req, createWebhookSchema);
  if (!parsed.ok) return parsed.response;
  const url = String(parsed.data.url ?? "").trim();
  const events = parsed.data.events ?? [];
  try {
    const { assertPublicUrl } = await import("@/lib/net-guard");
    assertPublicUrl(url);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "URL invalida" },
      { status: 400 }
    );
  }

  const result = await requireAction({
    minRole: "admin",
    run: async ({ ctx, user, tx }) => {
      const inserted = await tx
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
        userId: user.id,
        action: "webhook.create",
        resource: "outbound_webhook",
        resourceId: inserted[0]?.id,
        after: { url, events },
      });
      return inserted[0]!;
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result, { status: 201 });
}
