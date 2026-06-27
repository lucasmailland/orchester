import { unstable_cache } from "next/cache";
import { getFullDashboardStats, getOnboardingChecklistState } from "@/lib/db-queries";
import { withWorkspaceTx } from "@/lib/tenant/context";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";
import { DashboardClientLazy } from "@/components/dashboard/DashboardClientLazy";
import { OnboardingChecklist } from "@/components/onboarding/OnboardingChecklist";

/**
 * Cache the 22-query dashboard payload per workspace for 30 seconds.
 * Revalidate via tag if needed (`revalidateTag('dashboard:<wsId>')`) when
 * a high-impact mutation happens.
 */
const getCachedDashboard = (workspaceId: string) =>
  unstable_cache(
    async () => withWorkspaceTx(workspaceId, (tx) => getFullDashboardStats(workspaceId, tx)),
    ["dashboard", workspaceId],
    { revalidate: 30, tags: [`dashboard:${workspaceId}`] }
  )();

/**
 * Phase L.1: cheap snapshot of the 5 onboarding-checklist booleans.
 * Cached briefly so refreshes during a fresh-workspace walkthrough are
 * snappy; we don't tag-invalidate because the checklist is a soft hint
 * — a 30-second delay before "Create agent" flips to "Done" is fine.
 */
const getCachedOnboardingState = (workspaceId: string) =>
  unstable_cache(
    async () => withWorkspaceTx(workspaceId, (tx) => getOnboardingChecklistState(workspaceId, tx)),
    ["onboarding-checklist", workspaceId],
    { revalidate: 30, tags: [`onboarding:${workspaceId}`] }
  )();

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;

  const workspace = await getCurrentWorkspaceBySlug(workspaceSlug);
  const [stats, onboardingState] = workspace
    ? await Promise.all([
        getCachedDashboard(workspace.workspace.id).catch((e) => {
          console.error("[Dashboard] getFullDashboardStats failed:", e?.message ?? e);
          return null;
        }),
        getCachedOnboardingState(workspace.workspace.id).catch((e) => {
          console.error("[Dashboard] getOnboardingChecklistState failed:", e?.message ?? e);
          return null;
        }),
      ])
    : [null, null];

  if (!stats) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-faint">
        Sin datos de workspace.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {onboardingState && workspace && (
        <OnboardingChecklist
          state={onboardingState}
          workspaceId={workspace.workspace.id}
          locale={locale}
          workspaceSlug={workspaceSlug}
        />
      )}
      <DashboardClientLazy
        stats={stats}
        workspaceName={workspace?.workspace.name ?? ""}
        locale={locale}
        workspaceSlug={workspaceSlug}
      />
    </div>
  );
}
