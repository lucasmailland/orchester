import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { getTeamById, getTeamAgents, getTeamChannels } from "@/lib/db-queries";
import { TeamDetailClient } from "@/components/teams/TeamDetailClient";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "pages.teams" });

  const workspace = await getCurrentWorkspace();
  if (!workspace) notFound();

  const [team, agents, channels] = await Promise.all([
    getTeamById(workspace.workspace.id, id).catch(() => null),
    getTeamAgents(workspace.workspace.id, id).catch(() => []),
    getTeamChannels(workspace.workspace.id, id).catch(() => []),
  ]);

  if (!team) notFound();

  return (
    <TeamDetailClient
      team={team}
      agents={agents}
      channels={channels}
      labels={{
        agents: t("agents"),
        editTeam: t("editTeam"),
        deleteTeam: t("deleteTeam"),
        back: t("back"),
        confirmDelete: t("confirmDelete"),
        locale,
        teamFormLabels: {
          createTitle: t("createTitle"),
          editTitle: t("editTitle"),
          nameLabel: t("nameLabel"),
          descriptionLabel: t("descriptionLabel"),
          colorLabel: t("colorLabel"),
          save: t("save"),
          cancel: t("cancel"),
          namePlaceholder: t("namePlaceholder"),
          descriptionPlaceholder: t("descriptionPlaceholder"),
        },
      }}
    />
  );
}
