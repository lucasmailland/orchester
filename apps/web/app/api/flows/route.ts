import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { createFlow, listFlows, serviceErrorResponse } from "@/lib/flows/service";

const createFlowSchema = z.object({
  name: z.string().trim().min(1, "name required"),
  description: z.string().nullable().optional(),
  spec: z.string().nullable().optional(),
  templateId: z.string().optional(),
  // Inline graph seed used by the Compass TemplatePicker. The server-side
  // `flowTemplates` table is the canonical source when `templateId` is set;
  // these fields let the client seed a brand-new flow from the static
  // client registry without round-tripping a DB row. Ignored if a
  // `templateId` resolves successfully (DB wins over client payload).
  nodes: z.array(z.unknown()).optional(),
  edges: z.array(z.unknown()).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  const ctx = await requireAuth();
  if (!isAuthContext(ctx)) return ctx;
  const flows = await listFlows({
    kind: "user",
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
  });
  return NextResponse.json(flows);
}

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, createFlowSchema);
  if (!parsed.ok) return parsed.response;
  // Sin template, el flujo arranca vacío: así el builder muestra el estado guiado
  // con plantillas y disparadores para empezar (el usuario elige cómo arrancar).
  try {
    const { flow } = await createFlow(
      { kind: "user", workspaceId: ctx.workspace.id, userId: ctx.user.id },
      parsed.data
    );
    return NextResponse.json(flow, { status: 201 });
  } catch (e) {
    return serviceErrorResponse(e);
  }
}
