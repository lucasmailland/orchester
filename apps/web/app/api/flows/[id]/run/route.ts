import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { executeFlow } from "@/lib/flow-engine";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const result = await executeFlow({
    flowId: id,
    workspaceId: ws.workspace.id,
    triggerSource: "manual",
    input: body?.input ?? {},
  });
  return NextResponse.json(result);
}
