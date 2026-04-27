import { getTranslations } from "next-intl/server";
import { MessageSquare } from "lucide-react";
import { ConversationRow } from "@/components/conversations/ConversationRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { getConversations } from "@/lib/db-queries";
import { getCurrentWorkspace } from "@/lib/workspace";

export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.conversations" });

  const workspace = await getCurrentWorkspace();
  const conversations = workspace
    ? await getConversations(workspace.workspace.id, 50).catch(() => [])
    : [];

  const statusLabels = {
    open: t("status.open"),
    closed: t("status.closed"),
    escalated: t("status.escalated"),
  };

  const channelLabels = {
    web: t("channel.web"),
    whatsapp: t("channel.whatsapp"),
    telegram: t("channel.telegram"),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">{t("subtitle")}</p>
      </div>

      {conversations.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={28} />}
          title={t("empty")}
          description=""
          ctaLabel={t("emptyCta")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.07]">
          {conversations.map((conv) => (
            <ConversationRow
              key={conv.id}
              employeeName={conv.employeeName ?? null}
              agentName={conv.agentName ?? null}
              status={conv.status}
              channelType={conv.channelType ?? null}
              messageCount={conv.messageCount ?? 0}
              durationSeconds={conv.durationSeconds ?? null}
              startedAt={conv.startedAt}
              statusLabels={statusLabels}
              channelLabels={channelLabels}
              messagesLabel={t("messages")}
              durationLabel={t("duration")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
