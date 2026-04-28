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
    ? await getFullDashboardStats(workspace.workspace.id).catch((e) => {
        console.error("[Dashboard] getFullDashboardStats failed:", e?.message ?? e);
        console.error("[Dashboard] cause:", (e as any)?.cause?.message ?? (e as any)?.cause ?? "no cause");
        console.error("[Dashboard] stack:", e?.stack?.split("\n").slice(0, 5).join("\n"));
        return null;
      })
    : null;

  if (!stats) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-600">
        Sin datos de workspace.
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
