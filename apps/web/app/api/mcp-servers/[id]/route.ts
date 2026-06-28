import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { encrypt } from "@/lib/encryption";

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  authHeader: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;
  const { name, url, authHeader, enabled } = parsed.data;

  const result = await requireAction({
    minRole: "admin",
    run: async ({ ctx, tx }) => {
      const existing = await tx
        .select({ id: schema.mcpServers.id })
        .from(schema.mcpServers)
        .where(
          and(eq(schema.mcpServers.id, id), eq(schema.mcpServers.workspaceId, ctx.workspace.id))
        )
        .limit(1);
      if (!existing[0]) return { _err: "Not found", _status: 404 };
      const updates: Partial<typeof schema.mcpServers.$inferInsert> = {};
      if (name !== undefined) updates.name = name;
      if (url !== undefined) updates.url = url;
      if (authHeader !== undefined)
        updates.authHeaderEncrypted = authHeader ? encrypt(authHeader) : null;
      if (enabled !== undefined) updates.enabled = enabled;
      updates.updatedAt = new Date();
      await tx.update(schema.mcpServers).set(updates).where(eq(schema.mcpServers.id, id));
      return { id, updated: true };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await requireAction({
    minRole: "admin",
    run: async ({ ctx, tx }) => {
      const existing = await tx
        .select({ id: schema.mcpServers.id })
        .from(schema.mcpServers)
        .where(
          and(eq(schema.mcpServers.id, id), eq(schema.mcpServers.workspaceId, ctx.workspace.id))
        )
        .limit(1);
      if (!existing[0]) return { _err: "Not found", _status: 404 };
      await tx.delete(schema.mcpServers).where(eq(schema.mcpServers.id, id));
      return { id, deleted: true };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result);
}
