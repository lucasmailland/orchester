// apps/web/app/[locale]/deleted/[id]/page.tsx
//
// Reachable from the "you deleted your workspace" email. The link
// embeds the workspace ID + (optionally) the one-shot restore token:
//
//   https://app/{locale}/deleted/{id}?token=rst_xxx
//
// Auth model:
//   - The caller must be authenticated. We redirect to /login with a
//     callbackUrl pointing back here so the round-trip survives.
//   - If the caller is the original owner the token isn't required;
//     ownership alone is enough proof.
//   - Anyone holding the token can restore it once (the token burns
//     on first successful use).
//
// Workspace lookup MUST bypass tenant RLS because the workspace is in
// `status="deleted"` (and the caller might not even be a member, just
// a token holder). We use `withCrossTenantAdmin` for the read.
//
// Non-enumeration: if anything looks off (no workspace, wrong status,
// window passed, etc.) we render a SINGLE generic "expired or
// invalid" page. We never differentiate the failure modes — the
// audit log on the actual restore POST is the diagnostic surface.
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { schema } from "@orchester/db";
import { getCurrentSession } from "@/lib/workspace";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { DeletedWorkspaceRestoreCard } from "@/components/workspace/DeletedWorkspaceRestoreCard";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function DeletedWorkspaceRestorePage({ params, searchParams }: PageProps) {
  const { locale, id } = await params;
  const { token } = await searchParams;
  const t = await getTranslations("workspace.restore");

  const session = await getCurrentSession();
  if (!session) {
    // Preserve the token in the callback so the post-login redirect
    // lands back on this page with everything intact. Encode in case
    // a token character ever lands outside the URL-safe set.
    const callback = `/${locale}/deleted/${id}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    redirect(`/${locale}/login?callbackUrl=${encodeURIComponent(callback)}`);
  }

  // Cross-tenant read: the workspace is in `status='deleted'` so
  // tenant-scoped resolvers (which short-circuit on inaccessible
  // workspaces) would return null. We bypass FORCE-RLS explicitly via
  // `withCrossTenantAdmin` — every invocation is logged with a reason
  // so the security audit trail captures the read.
  const workspace = await withCrossTenantAdmin("deleted-workspace.restore_page", async (tx) => {
    const rows = await tx
      .select({
        id: schema.workspaces.id,
        slug: schema.workspaces.slug,
        name: schema.workspaces.name,
        status: schema.workspaces.status,
        ownerUserId: schema.workspaces.ownerUserId,
        deletedAt: schema.workspaces.deletedAt,
        deleteScheduledAt: schema.workspaces.deleteScheduledAt,
      })
      .from(schema.workspaces)
      .where(
        and(
          eq(schema.workspaces.id, id),
          eq(schema.workspaces.status, "deleted"),
          // Hard-delete cron flips `deleteScheduledAt` away from the
          // future when it sweeps. Filtering on `> now()` keeps
          // expired / partially-purged rows out of the response.
          gt(schema.workspaces.deleteScheduledAt, new Date())
        )
      )
      .limit(1);
    return rows[0] ?? null;
  });

  // Non-enumerable: any failure to find a restorable workspace
  // produces the SAME generic page. We never disclose whether the
  // workspace exists, was hard-deleted, or simply has the wrong ID.
  // Even an authenticated non-owner without a token gets this view —
  // the restore POST itself is the authorization gate; we just need a
  // reasonable UX surface for the link before they try.
  if (!workspace || !workspace.deletedAt || !workspace.deleteScheduledAt) {
    return <ExpiredOrInvalid title={t("expiredOrInvalid")} body={t("expiredOrInvalidBody")} />;
  }

  const isOwner = workspace.ownerUserId === session.user.id;

  // Without ownership AND without a token, there's nothing the user
  // can do — same generic surface so we don't help link-fishers map
  // which workspace IDs are restorable.
  if (!isOwner && !token) {
    return <ExpiredOrInvalid title={t("expiredOrInvalid")} body={t("expiredOrInvalidBody")} />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-app p-6">
      <DeletedWorkspaceRestoreCard
        workspace={{
          slug: workspace.slug,
          name: workspace.name,
          deletedAt: workspace.deletedAt.toISOString(),
          restoreUntil: workspace.deleteScheduledAt.toISOString(),
        }}
        initialToken={token ?? ""}
        isOwner={isOwner}
      />
    </main>
  );
}

function ExpiredOrInvalid({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-app p-6">
      <section className="mx-auto w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
        <h1 className="text-lg font-bold text-strong">{title}</h1>
        <p className="mt-3 text-sm text-muted">{body}</p>
      </section>
    </main>
  );
}
