import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { generateApiKey } from "@/lib/api-auth/key";
import { ALL_SCOPES, isKnownScope } from "@/lib/api-auth/scopes";
import { logAudit } from "@/lib/audit";

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  /**
   * What the key may do, as `<domain>:<access>`. Required to have at least one:
   * an empty list is how keys were stored before scopes were selectable and it
   * means full access, which must never be something a new key falls into by
   * omission. Callers that want everything ask for everything.
   */
  scopes: z
    .array(z.string().refine(isKnownScope, { message: "Unknown scope" }))
    .min(1, "Pick at least one permission")
    .max(ALL_SCOPES.length)
    .optional(),
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
  // Unique, and in the vocabulary's own order so two identical keys compare equal.
  const scopes = parsed.data.scopes
    ? ALL_SCOPES.filter((scope) => parsed.data.scopes!.includes(scope))
    : [...ALL_SCOPES];
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
      scopes,
      createdByUserId: ctx.user.id,
    })
    .returning();
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "apikey.create",
    resource: "api_key",
    resourceId: inserted[0]?.id,
    // What the key was granted, never the key itself.
    after: { name, scopes },
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
