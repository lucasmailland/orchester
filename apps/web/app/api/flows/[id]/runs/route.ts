import { NextResponse } from "next/server";
import { schema } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      return tx
        .select()
        .from(schema.flowRuns)
        .where(
          and(eq(schema.flowRuns.flowId, id), eq(schema.flowRuns.workspaceId, ctx.workspace.id))
        )
        .orderBy(desc(schema.flowRuns.startedAt))
        .limit(50);
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
