import { NextResponse } from "next/server";
import { listAllTools } from "@/lib/tools";
import { requireAction } from "@/lib/auth-guards";

const BUILTIN_META: Record<string, { label: string; emoji: string; category: string }> = {
  current_time: { label: "Hora actual", emoji: "🕐", category: "Utilidades" },
  calculator: { label: "Calculadora", emoji: "🧮", category: "Utilidades" },
  http_request: { label: "HTTP request", emoji: "🌐", category: "Integraciones" },
  flow_call: { label: "Invocar flujo", emoji: "🔀", category: "Orquestación" },
};

export async function GET() {
  const result = await requireAction({
    run: async () => {
      return listAllTools().map((t) => ({
        id: t.name,
        name: t.name,
        description: t.description,
        label: BUILTIN_META[t.name]?.label ?? t.name,
        emoji: BUILTIN_META[t.name]?.emoji ?? "🔧",
        category: BUILTIN_META[t.name]?.category ?? "Otros",
        builtin: true,
      }));
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
