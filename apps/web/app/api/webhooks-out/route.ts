import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import crypto from "node:crypto";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.outboundWebhooks)
    .where(eq(schema.outboundWebhooks.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.outboundWebhooks.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const url = String(body?.url ?? "").trim();
  const events = (body?.events as string[]) ?? [];
  if (!url.startsWith("http://") && !url.startsWith("https://"))
    return NextResponse.json({ error: "Valid URL required" }, { status: 400 });
  const db = getDb();
  const inserted = await db
    .insert(schema.outboundWebhooks)
    .values({
      id: createId(),
      workspaceId: ws.workspace.id,
      url,
      secret: crypto.randomBytes(32).toString("hex"),
      events,
    })
    .returning();
  return NextResponse.json(inserted[0]!, { status: 201 });
}
