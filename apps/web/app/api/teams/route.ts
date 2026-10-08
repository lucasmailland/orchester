import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";
import { parseBody } from "@/lib/validation";
import { createTeamSchema, createTeam, listTeams } from "@/lib/teams/service";

export async function GET() {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    teams: await listTeams({
      kind: "user",
      workspaceId: ctx.workspace.id,
      userId: session.user.id,
    }),
  });
}

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, createTeamSchema);
  if (!parsed.ok) return parsed.response;
  const team = await createTeam(
    { kind: "user", workspaceId: ctx.workspace.id, userId: ctx.user.id },
    parsed.data
  );
  return NextResponse.json(team, { status: 201 });
}
