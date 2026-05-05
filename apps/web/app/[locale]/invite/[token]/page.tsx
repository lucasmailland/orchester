import { redirect } from "next/navigation";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";
import { InviteAcceptClient } from "@/components/auth/InviteAcceptClient";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string; locale: string }>;
}) {
  const { token, locale } = await params;
  const session = await getCurrentSession();
  if (!session) {
    // Redirect to login with callbackUrl
    redirect(`/${locale}/login?callbackUrl=/${locale}/invite/${token}`);
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaceInvites)
    .where(eq(schema.workspaceInvites.token, token))
    .limit(1);
  const invite = rows[0];
  let workspaceName = "";
  if (invite) {
    const ws = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, invite.workspaceId))
      .limit(1);
    workspaceName = ws[0]?.name ?? "";
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-black p-6 text-zinc-100">
      <InviteAcceptClient
        token={token}
        invite={
          invite
            ? {
                email: invite.email,
                role: invite.role,
                status: invite.status,
                workspaceName,
              }
            : null
        }
      />
    </div>
  );
}
