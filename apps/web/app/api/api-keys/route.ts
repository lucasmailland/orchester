import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { generateApiKey } from "@/lib/api-auth/key";
import { logAudit } from "@/lib/audit";

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});

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
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, createApiKeySchema);
  if (!parsed.ok) return parsed.response;
  const name = (parsed.data.name ?? "API key").trim();
  const { plain, hashed, prefix } = generateApiKey();
  const db = getDb();
  const inserted = await db
    .insert(schema.apiKeys)
    .values({
      id: createId(),
      workspaceId: ctx.workspace.id,
      name,
      hashedKey: hashed,
      prefix,
      createdByUserId: ctx.user.id,
    })
    .returning();
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
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
