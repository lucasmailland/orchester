import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import crypto from "node:crypto";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

const createChannelSchema = z.object({
  name: z.string().trim().min(1, "name required"),
  type: z.enum(["widget", "web", "telegram", "slack", "whatsapp", "email", "api"]),
  agentId: z.string().optional(),
  // Optional seed config from a TemplatePicker selection (greeting, position, etc.).
  // Lands as-is into channels.config so the channel boots with a sensible default.
  config: z.record(z.string(), z.unknown()).optional(),
});

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
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, createChannelSchema);
  if (!parsed.ok) return parsed.response;
  const { name, type, agentId, config } = parsed.data;
  const db = getDb();
  const inserted = await db
    .insert(schema.channels)
    .values({
      id: createId(),
      workspaceId: ctx.workspace.id,
      name: name.trim(),
      type,
      status: "inactive",
      agentId: agentId ?? null,
      secret: crypto.randomBytes(20).toString("hex"),
      config: config ?? {},
    })
    .returning();
  const row = inserted[0];
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "channel.create",
    resource: "channel",
    resourceId: row.id,
    after: { name: row.name, type: row.type },
  });
  return NextResponse.json(row, { status: 201 });
}
