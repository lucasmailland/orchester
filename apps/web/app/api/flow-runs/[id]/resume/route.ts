import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { z } from "zod";

const bodySchema = z.object({
  token: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;
  const { id } = await params;
  const { resumeFlow } = await import("@/lib/flow-engine");
  try {
    const result = await resumeFlow(id, parsed.data.token, parsed.data.decision, ctx.workspace.id);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("not found") ||
      msg.includes("not waiting") ||
      msg.includes("Invalid resume")
    ) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
