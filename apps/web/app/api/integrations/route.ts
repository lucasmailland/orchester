import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAction } from "@/lib/auth-guards";
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
  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      const [catalog, configured] = await Promise.all([
        Promise.resolve(listConnectors()),
        listIntegrations(ctx.workspace.id, tx),
      ]);
      return { catalog, configured };
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const parsed = await parseBody(req, upsertIntegrationSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const result = await requireAction({
    minRole: "admin",
    run: async ({ ctx, user, tx }) => {
      try {
        const integration = await upsertIntegration(
          {
            workspaceId: ctx.workspace.id,
            type: body.type,
            name: body.name,
            config: body.config,
          },
          tx
        );
        await logAudit({
          workspaceId: ctx.workspace.id,
          userId: user.id,
          action: "integration.connect",
          resource: "integration",
          resourceId: integration.id,
          after: { type: body.type, name: body.name },
        });
        return { integration };
      } catch (e) {
        return { _handledError: e };
      }
    },
  });
  if (result instanceof Response) return result;
  if ("_handledError" in result)
    return handleError("[integrations] POST", result._handledError, 400);
  return NextResponse.json(result.integration);
}
