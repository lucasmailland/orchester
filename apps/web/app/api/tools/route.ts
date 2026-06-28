import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { listAllTools } from "@/lib/tools";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

const BUILTIN_META: Record<string, { label: string; emoji: string; category: string }> = {
  current_time: { label: "Hora actual", emoji: "🕐", category: "Utilidades" },
  calculator: { label: "Calculadora", emoji: "🧮", category: "Utilidades" },
  http_request: { label: "HTTP request", emoji: "🌐", category: "Integraciones" },
  flow_call: { label: "Invocar flujo", emoji: "🔀", category: "Orquestación" },
};

export async function GET() {
  const result = await requireAction({
    run: async ({ ctx }) => {
      const builtins = listAllTools().map((t) => ({
        id: t.name,
        name: t.name,
        description: t.description,
        label: BUILTIN_META[t.name]?.label ?? t.name,
        emoji: BUILTIN_META[t.name]?.emoji ?? "🔧",
        category: BUILTIN_META[t.name]?.category ?? "Otros",
        builtin: true,
      }));
      const db = getDb();
      const custom = await db
        .select()
        .from(schema.agentTools)
        .where(eq(schema.agentTools.workspaceId, ctx.workspace.id));
      const customItems = custom.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? "",
        label: r.name,
        emoji: "🔧",
        category: "Custom",
        builtin: false,
        kind: r.kind,
      }));
      return [...builtins, ...customItems];
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
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
        throw new Error(`Tool name '${body.name}' already exists in this workspace`);
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
