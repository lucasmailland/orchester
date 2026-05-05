import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";
import { generateApiKey } from "@/lib/api-auth/key";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      prefix: schema.apiKeys.prefix,
      scopes: schema.apiKeys.scopes,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      revokedAt: schema.apiKeys.revokedAt,
      createdAt: schema.apiKeys.createdAt,
    })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.apiKeys.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const ws = await getCurrentWorkspace();
  const session = await getCurrentSession();
  if (!ws || !session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "API key").trim();
  const { plain, hashed, prefix } = generateApiKey();
  const db = getDb();
  const inserted = await db
    .insert(schema.apiKeys)
    .values({
      id: createId(),
      workspaceId: ws.workspace.id,
      name,
      hashedKey: hashed,
      prefix,
      createdByUserId: session.user.id,
    })
    .returning();
  await logAudit({
    workspaceId: ws.workspace.id,
    userId: session.user.id,
    action: "apikey.create",
    resource: "api_key",
    resourceId: inserted[0]?.id,
  });
  // Return the plain key ONCE — never stored, never shown again
  return NextResponse.json(
    {
      id: inserted[0]!.id,
      name: inserted[0]!.name,
      prefix,
      key: plain, // <-- shown only here
    },
    { status: 201 }
  );
}
