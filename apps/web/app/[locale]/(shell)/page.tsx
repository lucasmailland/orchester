import { Bot, MessageSquare, Users, Clock } from "lucide-react";
import { motion } from "framer-motion";
import { getTranslations } from "next-intl/server";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { ConversationChart } from "@/components/dashboard/ConversationChart";
import { getDashboardStats } from "@/lib/db-queries";
import { getCurrentWorkspace } from "@/lib/workspace";
import { staggerContainer } from "@/lib/motion";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.dashboard" });

  const workspace = await getCurrentWorkspace();
  const stats = workspace
    ? await getDashboardStats(workspace.workspace.id).catch(() => null)
    : null;

  const kpis = [
    { label: t("activeAgents"), value: stats?.activeAgents ?? "—", icon: <Bot size={20} />, color: "primary" as const },
    { label: t("conversationsToday"), value: stats?.conversationsToday ?? "—", icon: <MessageSquare size={20} />, color: "accent" as const },
    { label: t("totalEmployees"), value: stats?.totalEmployees ?? "—", icon: <Users size={20} />, color: "success" as const },
    { label: t("avgResponseTime"), value: stats ? `${stats.avgDurationSeconds}${t("seconds")}` : "—", icon: <Clock size={20} />, color: "warning" as const },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-default-500">{t("subtitle")}</p>
      </div>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </motion.div>

      <div className="rounded-2xl border border-default-100 bg-background p-6 dark:border-white/5 dark:bg-white/[0.02]">
        <h2 className="mb-4 text-sm font-semibold text-default-700 dark:text-default-200">
          {t("conversationsChart")}
        </h2>
        <ConversationChart
          data={stats?.conversationsByDay ?? []}
          noDataLabel={t("noData")}
        />
      </div>
    </div>
  );
}
