import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import { eq, asc } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

const createLabelSchema = z.object({
  name: z.string().trim().min(1, "name required"),
  color: z.string().optional(),
});

export async function GET() {
  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      return tx
        .select()
        .from(schema.conversationLabels)
        .where(eq(schema.conversationLabels.workspaceId, ctx.workspace.id))
        .orderBy(asc(schema.conversationLabels.name));
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const parsed = await parseBody(req, createLabelSchema);
  if (!parsed.ok) return parsed.response;
  const { name, color } = parsed.data;

  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx, tx }) => {
      const inserted = await tx
        .insert(schema.conversationLabels)
        .values({
          id: createId(),
          workspaceId: ctx.workspace.id,
          name: name.trim(),
          color: color ?? "#8b5cf6",
        })
        .returning();
      return inserted[0]!;
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result, { status: 201 });
}
