import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { generateApiKey } from "@/lib/api-auth/key";
import { logAudit } from "@/lib/audit";

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});

export async function GET() {
  const result = await requireAction({
    minRole: "admin",
    run: async ({ ctx, tx }) => {
      return tx
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
        .where(eq(schema.apiKeys.workspaceId, ctx.workspace.id))
        .orderBy(desc(schema.apiKeys.createdAt));
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const parsed = await parseBody(req, createApiKeySchema);
  if (!parsed.ok) return parsed.response;
  const name = (parsed.data.name ?? "API key").trim();

  const result = await requireAction({
    minRole: "admin",
    run: async ({ ctx, user, tx }) => {
      const { plain, hashed, prefix } = generateApiKey();
      const inserted = await tx
        .insert(schema.apiKeys)
        .values({
          id: createId(),
          workspaceId: ctx.workspace.id,
          name,
          hashedKey: hashed,
          prefix,
          createdByUserId: user.id,
        })
        .returning();
      await logAudit({
        workspaceId: ctx.workspace.id,
        userId: user.id,
        action: "apikey.create",
        resource: "api_key",
        resourceId: inserted[0]?.id,
      });
      return {
        id: inserted[0]!.id,
        name: inserted[0]!.name,
        prefix,
        key: plain, // <-- shown only here
      };
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result, { status: 201 });
}
