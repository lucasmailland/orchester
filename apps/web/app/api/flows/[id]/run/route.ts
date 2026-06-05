import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { enqueueFlowRun } from "@/lib/flow-engine";

// `input` es JSON arbitrario definido por el trigger del flujo: no se restringe.
const runFlowSchema = z.object({
  input: z.unknown().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // flow.run requiere rol editor+ (viewer no puede ejecutar).
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, runFlowSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await enqueueFlowRun({
      flowId: id,
      workspaceId: ctx.workspace.id,
      triggerSource: `manual:${ctx.user.id}`,
      input: (parsed.data.input ?? {}) as Record<string, unknown>,
    });
    // 202 Accepted: la ejecución es asíncrona; el cliente hace polling de
    // /api/flow-runs/:runId. (Para feedback en vivo se usa /run-stream.)
    return NextResponse.json(result, { status: 202 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: msg === "Flow not found" ? 404 : 500 });
  }
}
