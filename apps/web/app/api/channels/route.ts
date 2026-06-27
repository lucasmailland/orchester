import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import crypto from "node:crypto";
import { schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
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
  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      const rows = await tx
        .select()
        .from(schema.channels)
        .where(eq(schema.channels.workspaceId, ctx.workspace.id))
        .orderBy(desc(schema.channels.updatedAt));
      // Don't leak credentialsEncrypted
      return rows.map(({ credentialsEncrypted, ...rest }) => ({
        ...rest,
        hasCredentials: Boolean(credentialsEncrypted),
      }));
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const parsed = await parseBody(req, createChannelSchema);
  if (!parsed.ok) return parsed.response;
  const { name, type, agentId, config } = parsed.data;

  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx, user, tx }) => {
      const inserted = await tx
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
      if (!row) return { _err: "Insert failed", _status: 500 };
      await logAudit({
        workspaceId: ctx.workspace.id,
        userId: user.id,
        action: "channel.create",
        resource: "channel",
        resourceId: row.id,
        after: { name: row.name, type: row.type },
      });
      return { row };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result.row, { status: 201 });
}
