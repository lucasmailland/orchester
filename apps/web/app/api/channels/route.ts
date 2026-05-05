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
    .from(schema.channels)
    .where(eq(schema.channels.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.channels.updatedAt));
  // Don't leak credentialsEncrypted
  return NextResponse.json(
    rows.map(({ credentialsEncrypted, ...rest }) => ({
      ...rest,
      hasCredentials: Boolean(credentialsEncrypted),
    }))
  );
}

export async function POST(req: Request) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { name, type, agentId } = body as {
    name: string;
    type: "widget" | "web" | "telegram" | "slack" | "whatsapp" | "email" | "api";
    agentId?: string;
  };
  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!type) return NextResponse.json({ error: "type required" }, { status: 400 });
  const db = getDb();
  const inserted = await db
    .insert(schema.channels)
    .values({
      id: createId(),
      workspaceId: ws.workspace.id,
      name: name.trim(),
      type,
      status: "inactive",
      agentId: agentId ?? null,
      secret: crypto.randomBytes(20).toString("hex"),
      config: {},
    })
    .returning();
  const row = inserted[0];
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}
