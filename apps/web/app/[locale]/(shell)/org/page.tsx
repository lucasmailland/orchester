import { getTranslations } from "next-intl/server";
import { OrgChart } from "@/components/org/OrgChart";
import { getOrgData } from "@/lib/db-queries";
import { getCurrentWorkspace } from "@/lib/workspace";

export default async function OrgPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.org" });

  const workspace = await getCurrentWorkspace();
  const teams = workspace
    ? await getOrgData(workspace.workspace.id).catch(() => [])
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">{t("subtitle")}</p>
      </div>
      <OrgChart
        workspaceName={workspace?.workspace.name ?? "Orchester"}
        teams={teams}
      />
    </div>
  );
}
