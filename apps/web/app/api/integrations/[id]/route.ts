import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { testIntegration, deleteIntegration, upsertIntegration } from "@/lib/integrations/store";

const testIntegrationSchema = z.object({ action: z.literal("test") });
const upsertIntegrationSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  // config son credenciales/ajustes libres por conector — no se loguean.
  config: z.record(z.string(), z.string()),
});

/**
 * POST   /api/integrations/[id]   { action: "test" }  → re-testea la conexión
 * PATCH  /api/integrations/[id]   { type, name, config } → actualiza
 * DELETE /api/integrations/[id]   → elimina
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, testIntegrationSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await testIntegration(ctx.workspace.id, id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, upsertIntegrationSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  try {
    const result = await upsertIntegration({
      workspaceId: ctx.workspace.id,
      id,
      type: body.type,
      name: body.name,
      config: body.config,
    });
    await logAudit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: "integration.update",
      resource: "integration",
      resourceId: id,
      after: { type: body.type, name: body.name },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  await deleteIntegration(ctx.workspace.id, id);
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "integration.delete",
    resource: "integration",
    resourceId: id,
  });
  return NextResponse.json({ ok: true });
}
