import { NextResponse } from "next/server";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";
import { loadFlowSheet } from "@/lib/flows/describe-load";
import { serviceErrorResponse } from "@/lib/flows/service";

/** The flow's fact sheet, computed from its graph. Same function as the MCP `describe_flow`. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json(
      await loadFlowSheet(
        { kind: "user", workspaceId: ws.workspace.id, userId: session.user.id },
        id
      )
    );
  } catch (e) {
    return serviceErrorResponse(e);
  }
}
