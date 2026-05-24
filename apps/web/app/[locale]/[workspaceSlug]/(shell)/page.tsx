import { unstable_cache } from "next/cache";
import { getFullDashboardStats } from "@/lib/db-queries";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";
import { DashboardClientLazy } from "@/components/dashboard/DashboardClientLazy";

/**
 * Cache the 22-query dashboard payload per workspace for 30 seconds.
 * Revalidate via tag if needed (`revalidateTag('dashboard:<wsId>')`) when
 * a high-impact mutation happens.
 */
const getCachedDashboard = (workspaceId: string) =>
  unstable_cache(async () => getFullDashboardStats(workspaceId), ["dashboard", workspaceId], {
    revalidate: 30,
    tags: [`dashboard:${workspaceId}`],
  })();

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;

  const workspace = await getCurrentWorkspaceBySlug(workspaceSlug);
  const stats = workspace
    ? await getCachedDashboard(workspace.workspace.id).catch((e) => {
        console.error("[Dashboard] getFullDashboardStats failed:", e?.message ?? e);
        return null;
      })
    : null;

  if (!stats) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-faint">
        Sin datos de workspace.
      </div>
    );
  }

  return (
    <DashboardClientLazy
      stats={stats}
      workspaceName={workspace?.workspace.name ?? ""}
      locale={locale}
      workspaceSlug={workspaceSlug}
    />
  );
}
