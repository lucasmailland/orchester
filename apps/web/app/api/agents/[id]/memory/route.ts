import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { listMemoryRows, setMemory, removeMemory } from "@/lib/memory";

const setMemorySchema = z.object({
  scope: z.enum(["global", "conversation", "employee"]),
  key: z.string().min(1),
  // value es contenido arbitrario que el agente persiste.
  value: z.unknown().optional(),
  conversationId: z.string().optional(),
  employeeId: z.string().optional(),
});

/** GET — list every memory row for an agent (admin / debug view). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await requireAction({
    run: async ({ ctx }) => {
      return listMemoryRows(id, ctx.workspace.id);
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

/** POST — upsert a key into a scope. Body: { scope, key, value, conversationId?, employeeId? } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseBody(req, setMemorySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const key = body.key.trim();
  if (!key) return NextResponse.json({ error: "scope and key required" }, { status: 400 });

  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx }) => {
      return setMemory({
        agentId: id,
        workspaceId: ctx.workspace.id,
        scope: body.scope,
        key,
        value: body.value,
        conversationId: body.conversationId,
        employeeId: body.employeeId,
      });
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

/** DELETE — remove a key (or whole scope row if key omitted). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") as "global" | "conversation" | "employee" | null;
  const key = url.searchParams.get("key");
  const conversationId = url.searchParams.get("conversationId");
  const employeeId = url.searchParams.get("employeeId");
  if (!scope) return NextResponse.json({ error: "scope required" }, { status: 400 });

  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx }) => {
      await removeMemory({
        agentId: id,
        workspaceId: ctx.workspace.id,
        scope,
        key,
        ...(conversationId ? { conversationId } : {}),
        ...(employeeId ? { employeeId } : {}),
      });
      return { ok: true };
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
