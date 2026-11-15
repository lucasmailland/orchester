import { redirect } from "next/navigation";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";
import { UsagePageClient } from "@/components/usage/UsagePageClient";
import { getTranslations } from "next-intl/server";
import { getUsagePageData } from "@/lib/usage/data";
import { Zap, DollarSign, MessageSquare, TrendingUp } from "lucide-react";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default async function UsagePage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  const t = await getTranslations({ locale, namespace: "pages.usage" });

  const ctx = await getCurrentWorkspaceBySlug(workspaceSlug);
  if (!ctx) {
    redirect(`/${locale}`);
  }

  const data = await getUsagePageData(ctx.workspace.id);

  const avgTokensPerConv =
    data.totalConversations > 0 ? Math.round(data.totalTokens / data.totalConversations) : 0;

  const kpis = [
    {
      label: t("totalTokens"),
      value: formatTokens(data.totalTokens),
      sub: "last 30 days",
      icon: <Zap className="h-4 w-4" />,
      color: "accent" as const,
    },
    {
      label: t("estimatedCost"),
      value: `$${data.totalCostUsd.toFixed(2)}`,
      sub: "all time",
      icon: <DollarSign className="h-4 w-4" />,
      color: "success" as const,
    },
    {
      label: t("conversations"),
      value: data.totalConversations.toLocaleString(),
      sub: "all time",
      icon: <MessageSquare className="h-4 w-4" />,
      color: "warning" as const,
    },
    {
      label: t("avgTokens"),
      value: formatTokens(avgTokensPerConv),
      sub: "per conversation",
      icon: <TrendingUp className="h-4 w-4" />,
      color: "primary" as const,
    },
  ];

  const labels = {
    title: t("title"),
    subtitle: t("subtitle"),
    chartTitle: t("chartTitle"),
    agentTableTitle: t("agentTableTitle"),
    noData: t("noData"),
    agent: t("col.agent"),
    model: t("col.model"),
    conversations: t("col.conversations"),
    tokens: t("col.tokens"),
    cost: t("col.cost"),
  };

  return (
    <UsagePageClient
      kpis={kpis}
      tokensByDay={data.tokensByDay}
      agentUsage={data.agentUsage}
      labels={labels}
    />
  );
}
