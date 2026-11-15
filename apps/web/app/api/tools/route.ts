import { NextResponse } from "next/server";
import { listWorkspaceMcpTools } from "@/lib/integrations/mcp-tools";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import { listAllTools } from "@/lib/tools";
import { getCurrentWorkspace } from "@/lib/workspace";
import { listCustomTools } from "@/lib/agent-tools/custom";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

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
  const custom = await listCustomTools(ws.workspace.id);
  return NextResponse.json([...tools, ...remote, ...custom]);
}

const createToolSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/),
  description: z.string().max(512).optional(),
  kind: z.enum(["http_request", "custom"]),
  config: z.record(z.string(), z.unknown()),
});

export async function POST(req: Request) {
  const parsed = await parseBody(req, createToolSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  // The model calls tools by name: a custom tool must not shadow a builtin.
  if (listAllTools().some((t) => t.name === body.name) || body.name.startsWith("mcp__")) {
    return NextResponse.json({ error: `'${body.name}' is a reserved tool name` }, { status: 409 });
  }

  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx, tx }) => {
      const existing = await tx
        .select({ id: schema.agentTools.id })
        .from(schema.agentTools)
        .where(
          and(
            eq(schema.agentTools.workspaceId, ctx.workspace.id),
            eq(schema.agentTools.name, body.name)
          )
        )
        .limit(1);
      if (existing.length > 0) {
        return NextResponse.json(
          { error: `Tool name '${body.name}' already exists in this workspace` },
          { status: 409 }
        );
      }
      const id = createId();
      await tx.insert(schema.agentTools).values({
        id,
        workspaceId: ctx.workspace.id,
        name: body.name,
        description: body.description ?? null,
        kind: body.kind,
        config: body.config,
      });
      return { id, name: body.name };
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result, { status: 201 });
}
