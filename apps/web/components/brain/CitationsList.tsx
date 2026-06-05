"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { MessageSquare, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@heroui/react";
import { useFactCitations } from "@/lib/hooks/use-brain-facts";

export interface CitationsListProps {
  factId: string;
}

export function CitationsList({ factId }: CitationsListProps) {
  const t = useTranslations("brain");
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";
  const { citations, error, isLoading } = useFactCitations(factId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-danger">{t("errors.citationsFailed")}</p>;
  }

  if (citations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-card p-6 text-center">
        <MessageSquare className="mx-auto h-5 w-5 text-faint" />
        <p className="mt-2 text-xs text-faint">{t("detail.noCitations")}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {citations.map((c) => {
        // Deep-link target: full conversation + message anchor when both
        // ids are available. The conversation detail page reads
        // `#message-{id}` as a scroll target — if the route doesn't ship
        // anchor-scroll yet the link still navigates to the conversation
        // (hash is ignored, no broken UX).
        const href = c.conversationId
          ? `/${locale}/${ws}/conversations/${c.conversationId}#message-${c.id}`
          : null;
        const Card = (
          <div className="rounded-lg border border-line bg-card p-3 transition-colors hover:border-violet-500/40 hover:bg-elevated">
            <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-faint">
              <span>{c.role}</span>
              <span title={c.createdAt}>{new Date(c.createdAt).toLocaleDateString()}</span>
            </div>
            <p className="mt-1.5 line-clamp-3 text-xs text-body">{c.content}</p>
            {href ? (
              <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-violet-500">
                {t("detail.openConversation")}
                <ExternalLink className="h-3 w-3" />
              </span>
            ) : null}
          </div>
        );
        return (
          <li key={c.id}>
            {href ? (
              <Link href={href} className="block">
                {Card}
              </Link>
            ) : (
              Card
            )}
          </li>
        );
      })}
    </ul>
  );
}
