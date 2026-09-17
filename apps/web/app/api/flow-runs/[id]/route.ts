import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { getFlowRun, serviceErrorResponse } from "@/lib/flows/service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  try {
    const { run, steps } = await getFlowRun(
      { kind: "user", workspaceId: ctx.workspace.id, userId: ctx.user.id },
      id
    );
    return NextResponse.json({ run, steps });
  } catch (e) {
    return serviceErrorResponse(e);
  }
}
