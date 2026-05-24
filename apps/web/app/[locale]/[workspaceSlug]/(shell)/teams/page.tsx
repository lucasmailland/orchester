import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";
import { TeamCard } from "@/components/teams/TeamCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { TeamsPageClient } from "@/components/teams/TeamsPageClient";

import { getTeams } from "@/lib/db-queries";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";

export default async function TeamsPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  const t = await getTranslations({ locale, namespace: "pages.teams" });

  const workspace = await getCurrentWorkspaceBySlug(workspaceSlug);
  const teams = workspace ? await getTeams(workspace.workspace.id).catch(() => []) : [];

  const formLabels = {
    createTitle: t("createTitle"),
    editTitle: t("editTitle"),
    nameLabel: t("nameLabel"),
    descriptionLabel: t("descriptionLabel"),
    colorLabel: t("colorLabel"),
    save: t("save"),
    cancel: t("cancel"),
    namePlaceholder: t("namePlaceholder"),
    descriptionPlaceholder: t("descriptionPlaceholder"),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-strong">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
        </div>
        <TeamsPageClient addTeamLabel={t("addTeam")} formLabels={formLabels} />
      </div>

      {teams.length === 0 ? (
        <EmptyState icon={<Users size={28} />} title={t("empty")} description="" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              id={team.id}
              name={team.name}
              description={team.description ?? null}
              avatarColor={team.avatarColor ?? null}
              agentCount={team.agentCount}
              channelCount={team.channelCount}
              locale={locale}
              workspaceSlug={workspaceSlug}
            />
          ))}
        </div>
      )}
    </div>
  );
}
