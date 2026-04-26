import { getTranslations } from "next-intl/server";
import { Bot } from "lucide-react";
import { motion } from "framer-motion";
import { AgentRow } from "@/components/agents/AgentRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { getAgents } from "@/lib/db-queries";
import { getCurrentWorkspace } from "@/lib/workspace";
import { staggerContainer } from "@/lib/motion";

export default async function AgentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.agents" });

  const workspace = await getCurrentWorkspace();
  const agents = workspace
    ? await getAgents(workspace.workspace.id).catch(() => [])
    : [];

  const statusLabels = {
    active: t("status.active"),
    inactive: t("status.inactive"),
    draft: t("status.draft"),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-default-500">{t("subtitle")}</p>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          icon={<Bot size={28} />}
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
          className="flex flex-col gap-2"
        >
          {agents.map((agent) => (
            <AgentRow
              key={agent.id}
              name={agent.name}
              role={agent.role}
              model={agent.model}
              status={agent.status}
              teamName={agent.teamName ?? null}
              statusLabels={statusLabels}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}
