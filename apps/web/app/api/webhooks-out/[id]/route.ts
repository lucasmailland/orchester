import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { sendTestEvent } from "@/lib/webhooks-out";

/** POST /api/webhooks-out/[id]  { action: "test" } → entrega un evento de prueba. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "test") {
    return NextResponse.json({ error: "action no soportada" }, { status: 400 });
  }
  const result = await sendTestEvent(ws.workspace.id, id);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  const set: Record<string, unknown> = {};
  if (body.url !== undefined) set.url = body.url;
  if (body.events !== undefined) set.events = body.events;
  if (body.enabled !== undefined) set.enabled = !!body.enabled;
  const updated = await db
    .update(schema.outboundWebhooks)
    .set(set)
    .where(
      and(
        eq(schema.outboundWebhooks.id, id),
        eq(schema.outboundWebhooks.workspaceId, ws.workspace.id)
      )
    )
    .returning();
  if (!updated[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated[0]);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const deleted = await db
    .delete(schema.outboundWebhooks)
    .where(
      and(
        eq(schema.outboundWebhooks.id, id),
        eq(schema.outboundWebhooks.workspaceId, ws.workspace.id)
      )
    )
    .returning({ id: schema.outboundWebhooks.id });
  if (!deleted[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
