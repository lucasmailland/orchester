import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { extractRequestSchema } from "@/lib/flows/extract-request";
import { extractToFlow, previewExtraction, serviceErrorResponse } from "@/lib/flows/service";

/**
 * Moves a group of steps (or a selection) into a new flow and calls it from
 * where it was, in one transaction. With `preview: true` it only returns the
 * plan: the steps that move, the inputs and outputs it would map, the new
 * flow's kind, and why it is refused when it cannot move.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, extractRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { preview, ...input } = parsed.data;
  const actor = { kind: "user" as const, workspaceId: ctx.workspace.id, userId: ctx.user.id };
  try {
    if (preview) return NextResponse.json(await previewExtraction(actor, id, input));
    const { plan, child, parent } = await extractToFlow(actor, id, input);
    return NextResponse.json(
      {
        plan,
        child: { id: child.id, name: child.name, kind: child.kind, enabled: child.enabled },
        parent,
      },
      { status: 201 }
    );
  } catch (e) {
    return serviceErrorResponse(e);
  }
}
