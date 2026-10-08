import { NextResponse } from "next/server";
import { listWorkspaceMcpTools } from "@/lib/integrations/mcp-tools";
import { listAllTools } from "@/lib/tools";
import { getCurrentWorkspace } from "@/lib/workspace";

const BUILTIN_META: Record<string, { label: string; emoji: string; category: string }> = {
  current_time: { label: "Hora actual", emoji: "🕐", category: "Utilidades" },
  calculator: { label: "Calculadora", emoji: "🧮", category: "Utilidades" },
  http_request: { label: "HTTP request", emoji: "🌐", category: "Integraciones" },
  flow_call: { label: "Invocar flujo", emoji: "🔀", category: "Orquestación" },
};

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tools = listAllTools().map((t) => ({
    id: t.name,
    name: t.name,
    description: t.description,
    label: BUILTIN_META[t.name]?.label ?? t.name,
    emoji: BUILTIN_META[t.name]?.emoji ?? "🔧",
    category: BUILTIN_META[t.name]?.category ?? "Otros",
    builtin: true,
  }));
  const remote = (await listWorkspaceMcpTools(ws.workspace.id)).map((tool) => ({
    id: tool.name,
    name: tool.name,
    description: tool.description,
    label: tool.remoteName,
    category: tool.integrationName,
    builtin: false,
    effect: tool.effect,
  }));
  return NextResponse.json([...tools, ...remote]);
}
