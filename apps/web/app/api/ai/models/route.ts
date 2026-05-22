import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { listConnectedProviderIds } from "@/lib/ai/credentials";
import { modelsFor, providersFor, type Capability } from "@/lib/ai/catalog";

/**
 * GET /api/ai/models?capability=chat|image|embedding|...
 * Devuelve los modelos disponibles para esa capacidad de los proveedores YA
 * conectados, más la lista de proveedores (con flag connected) para el hint.
 */
export async function GET(req: Request) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const capability = (new URL(req.url).searchParams.get("capability") ?? "chat") as Capability;

  const connected = new Set(await listConnectedProviderIds(ws.workspace.id));
  const models = modelsFor(capability)
    .filter((m) => connected.has(m.provider))
    .map((m) => ({ id: m.id, name: m.name, provider: m.provider, tier: m.tier ?? null }));
  const providers = providersFor(capability).map((p) => ({
    id: p.id,
    name: p.name,
    connected: connected.has(p.id),
  }));
  return NextResponse.json({ models, providers });
}
