import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";
import { motion } from "framer-motion";
import { TeamCard } from "@/components/teams/TeamCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { getTeams } from "@/lib/db-queries";
import { getCurrentWorkspace } from "@/lib/workspace";
import { staggerContainer, staggerItem } from "@/lib/motion";

export default async function TeamsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.teams" });

  const workspace = await getCurrentWorkspace();
  const teams = workspace
    ? await getTeams(workspace.workspace.id).catch(() => [])
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-default-500">{t("subtitle")}</p>
      </div>

      {teams.length === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title={t("empty")}
          description=""
          ctaLabel={t("emptyCta")}
          onCta={() => {}}
        />
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {teams.map((team) => (
            <motion.div key={team.id} variants={staggerItem}>
              <TeamCard
                name={team.name}
                description={team.description ?? null}
                avatarColor={team.avatarColor ?? null}
                agentCount={team.agentCount}
                agentsLabel={t("agents")}
              />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
