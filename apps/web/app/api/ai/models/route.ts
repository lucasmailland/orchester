import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { modelsFor, providersFor, type Capability } from "@/lib/ai/catalog";

/**
 * GET /api/ai/models?capability=chat|image|embedding|...
 * Modelos disponibles para esa capacidad de los proveedores conectados. Para
 * chat también incluye los modelos detectados dinámicamente al "Probar" la
 * conexión (modelsJson) — clave para Azure (deployments propios) y variantes.
 */
export async function GET(req: Request) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const capability = (new URL(req.url).searchParams.get("capability") ?? "chat") as Capability;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aiProviders)
    .where(eq(schema.aiProviders.workspaceId, ws.workspace.id));
  const connectedRows = rows.filter((r) => r.enabled);
  const connected = new Set(connectedRows.map((r) => r.provider));

  type Out = { id: string; name: string; provider: string; tier: string | null; ctx: number | null };
  const seen = new Set<string>();
  const models: Out[] = [];
  for (const m of modelsFor(capability)) {
    if (!connected.has(m.provider)) continue;
    seen.add(m.id);
    models.push({ id: m.id, name: m.name, provider: m.provider, tier: m.tier ?? null, ctx: m.contextWindow ?? null });
  }
  // Modelos detectados al probar la conexión (sólo aplican a chat).
  if (capability === "chat") {
    for (const r of connectedRows) {
      for (const m of r.modelsJson ?? []) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        models.push({ id: m.id, name: m.name, provider: r.provider, tier: m.tier ?? null, ctx: m.contextWindow ?? null });
      }
    }
  }

  const providers = providersFor(capability).map((p) => ({ id: p.id, name: p.name, connected: connected.has(p.id) }));
  return NextResponse.json({ models, providers });
}
