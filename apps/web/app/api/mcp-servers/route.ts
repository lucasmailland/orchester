import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { encrypt } from "@/lib/encryption";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  authHeader: z.string().optional(),
});

export async function GET() {
  const result = await requireAction({
    run: async ({ ctx, tx }) =>
      tx
        .select({
          id: schema.mcpServers.id,
          name: schema.mcpServers.name,
          transport: schema.mcpServers.transport,
          url: schema.mcpServers.url,
          enabled: schema.mcpServers.enabled,
          lastTestedAt: schema.mcpServers.lastTestedAt,
          lastError: schema.mcpServers.lastError,
          createdAt: schema.mcpServers.createdAt,
        })
        .from(schema.mcpServers)
        .where(eq(schema.mcpServers.workspaceId, ctx.workspace.id)),
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const parsed = await parseBody(req, createSchema);
  if (!parsed.ok) return parsed.response;
  const { name, url, authHeader } = parsed.data;

  const result = await requireAction({
    minRole: "admin",
    run: async ({ ctx, tx }) => {
      const id = createId();
      await tx.insert(schema.mcpServers).values({
        id,
        workspaceId: ctx.workspace.id,
        name,
        url,
        authHeaderEncrypted: authHeader ? encrypt(authHeader) : null,
        enabled: true,
      });
      return { id, name, url, enabled: true };
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result, { status: 201 });
}
