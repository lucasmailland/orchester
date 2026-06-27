import { NextResponse } from "next/server";
import { schema } from "@orchester/db";
import { eq, or, and, asc } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";

/**
 * Returns: public templates + workspace-private templates.
 */
export async function GET() {
  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      return tx
        .select()
        .from(schema.flowTemplates)
        .where(
          or(
            eq(schema.flowTemplates.isPublic, true),
            and(
              eq(schema.flowTemplates.isPublic, false),
              eq(schema.flowTemplates.workspaceId, ctx.workspace.id)
            )
          )
        )
        .orderBy(asc(schema.flowTemplates.category), asc(schema.flowTemplates.name));
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
