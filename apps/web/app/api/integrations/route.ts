import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { listConnectors } from "@/lib/integrations/registry";
import { listIntegrations, upsertIntegration } from "@/lib/integrations/store";

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
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    type?: string;
    name?: string;
    config?: Record<string, string>;
  };
  if (!body.type || !body.name || !body.config) {
    return NextResponse.json({ error: "type, name y config son requeridos" }, { status: 400 });
  }
  try {
    const result = await upsertIntegration({
      workspaceId: ws.workspace.id,
      type: body.type,
      name: body.name,
      config: body.config,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
