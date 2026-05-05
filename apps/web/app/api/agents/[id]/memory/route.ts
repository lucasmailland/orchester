import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { listMemoryRows, setMemory, removeMemory } from "@/lib/memory";

/** GET — list every memory row for an agent (admin / debug view). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const rows = await listMemoryRows(id, ws.workspace.id);
  return NextResponse.json(rows);
}

/** POST — upsert a key into a scope. Body: { scope, key, value, conversationId?, employeeId? } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const scope = body?.scope as "global" | "conversation" | "employee";
  const key = String(body?.key ?? "").trim();
  if (!scope || !key) return NextResponse.json({ error: "scope and key required" }, { status: 400 });
  const out = await setMemory({
    agentId: id,
    workspaceId: ws.workspace.id,
    scope,
    key,
    value: body.value,
    conversationId: body.conversationId,
    employeeId: body.employeeId,
  });
  return NextResponse.json(out);
}

/** DELETE — remove a key (or whole scope row if key omitted). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") as "global" | "conversation" | "employee" | null;
  const key = url.searchParams.get("key");
  const conversationId = url.searchParams.get("conversationId");
  const employeeId = url.searchParams.get("employeeId");
  if (!scope) return NextResponse.json({ error: "scope required" }, { status: 400 });
  await removeMemory({
    agentId: id,
    workspaceId: ws.workspace.id,
    scope,
    key,
    ...(conversationId ? { conversationId } : {}),
    ...(employeeId ? { employeeId } : {}),
  });
  return NextResponse.json({ ok: true });
}
