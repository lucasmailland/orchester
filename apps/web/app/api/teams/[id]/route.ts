import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { updateTeamSchema, updateTeam, deleteTeam } from "@/lib/teams/service";
import { adminErrorResponse } from "@/lib/workspace-admin";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, updateTeamSchema);
  if (!parsed.ok) return parsed.response;
  try {
    return NextResponse.json(
      await updateTeam(
        { kind: "user", workspaceId: ctx.workspace.id, userId: ctx.user.id },
        id,
        parsed.data
      )
    );
  } catch (e) {
    return adminErrorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  try {
    return NextResponse.json(
      await deleteTeam({ kind: "user", workspaceId: ctx.workspace.id, userId: ctx.user.id }, id)
    );
  } catch (e) {
    return adminErrorResponse(e);
  }
}
