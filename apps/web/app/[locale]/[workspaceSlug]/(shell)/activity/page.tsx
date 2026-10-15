import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { loadActivityFilterOptions } from "@/lib/activity/query";
import { ActivityClient } from "@/components/activity/ActivityClient";

/**
 * /[locale]/[workspaceSlug]/activity — which agent or flow did what, with
 * which data and at what cost, and who changed what. Owner and admin only
 * (`activity.read`); other roles get a 404, like a page that is not there.
 * The endpoints it calls check the role again.
 */
export default async function ActivityPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  const ws = await getCurrentWorkspaceBySlug(workspaceSlug);
  if (!ws || !can(ws.role, "activity.read")) notFound();

  const [t, options] = await Promise.all([
    getTranslations({ locale, namespace: "pages.activity" }),
    loadActivityFilterOptions(ws.workspace.id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-strong">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </div>
      <ActivityClient workspaceSlug={workspaceSlug} options={options} />
    </div>
  );
}
