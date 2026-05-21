import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { testIntegration, deleteIntegration, upsertIntegration } from "@/lib/integrations/store";

/**
 * POST   /api/integrations/[id]   { action: "test" }  → re-testea la conexión
 * PATCH  /api/integrations/[id]   { type, name, config } → actualiza
 * DELETE /api/integrations/[id]   → elimina
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "test") {
    return NextResponse.json({ error: "action no soportada" }, { status: 400 });
  }
  try {
    const result = await testIntegration(ws.workspace.id, id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
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
      id,
      type: body.type,
      name: body.name,
      config: body.config,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await deleteIntegration(ws.workspace.id, id);
  return NextResponse.json({ ok: true });
}
