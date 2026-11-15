import { redirect } from "next/navigation";
import { schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";
import { hashApiKey } from "@/lib/api-auth/key";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { InviteAcceptClient } from "@/components/auth/InviteAcceptClient";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string; locale: string }>;
}) {
  const { token, locale } = await params;
  const session = await getCurrentSession();
  if (!session) {
    // Redirect to login; LoginForm reads ?return= (not ?callbackUrl=).
    redirect(`/${locale}/login?return=/${locale}/invite/${token}`);
  }
  // workspace_invite and workspace are FORCE RLS and the visitor is not a
  // member yet, so the lookup crosses tenants. The token at rest is a hash.
  const { invite, workspaceName } = await withCrossTenantAdmin("invite.view", async (tx) => {
    const rows = await tx
      .select()
      .from(schema.workspaceInvites)
      .where(eq(schema.workspaceInvites.token, hashApiKey(token)))
      .limit(1);
    const found = rows[0];
    if (!found) return { invite: undefined, workspaceName: "" };
    const ws = await tx
      .select({ name: schema.workspaces.name })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, found.workspaceId))
      .limit(1);
    return { invite: found, workspaceName: ws[0]?.name ?? "" };
  });
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
