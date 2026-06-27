import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { listConnectors } from "@/lib/integrations/registry";
import { listIntegrations, upsertIntegration } from "@/lib/integrations/store";
import { handleError } from "@/lib/api-response";

const upsertIntegrationSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  // config son credenciales/ajustes libres por conector — no se loguean.
  config: z.record(z.string(), z.string()),
});

/**
 * GET /api/integrations
 *   → { catalog: Connector[], configured: WorkspaceIntegration[] }
 * POST /api/integrations  { type, name, config }
 *   → crea/testea una integración. Devuelve estado de conexión.
 */
export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [catalog, configured] = await Promise.all([
    Promise.resolve(listConnectors()),
    listIntegrations(ws.workspace.id),
  ]);
  return NextResponse.json({ catalog, configured });
}

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, upsertIntegrationSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  try {
    const result = await upsertIntegration({
      workspaceId: ctx.workspace.id,
      type: body.type,
      name: body.name,
      config: body.config,
    });
    await logAudit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: "integration.connect",
      resource: "integration",
      resourceId: result.id,
      after: { type: body.type, name: body.name },
    });
    return NextResponse.json(result);
  } catch (e) {
    return handleError("[integrations] POST", e, 400);
  }
}
