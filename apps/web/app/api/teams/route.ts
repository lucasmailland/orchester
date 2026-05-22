import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

const createTeamSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().optional(),
  avatarColor: z.string().optional(),
});

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  const parsed = await parseBody(req, createTeamSchema);
  if (!parsed.ok) return parsed.response;
  const { name, description, avatarColor } = parsed.data;

  const db = getDb();
  const [team] = await db
    .insert(schema.teams)
    .values({
      id: createId(),
      workspaceId: ctx.workspace.id,
      name: name.trim(),
      description: description?.trim() || null,
      avatarColor: avatarColor || "#7C3AED",
    })
    .returning();

  return NextResponse.json(team, { status: 201 });
}
