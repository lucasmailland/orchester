import { getFullDashboardStats } from "@/lib/db-queries";
import { getCurrentWorkspace } from "@/lib/workspace";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const workspace = await getCurrentWorkspace();
  const stats = workspace
    ? await getFullDashboardStats(workspace.workspace.id).catch(() => null)
    : null;

  if (!stats) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-600">
        No workspace data available.
      </div>
    );
  }

  return (
    <DashboardClient
      stats={stats}
      workspaceName={workspace?.workspace.name ?? ""}
      locale={locale}
    />
  );
}
