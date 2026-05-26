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
      {citations.map((c) => (
        <li key={c.id} className="rounded-lg border border-line bg-card p-3">
          <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-faint">
            <span>{c.role}</span>
            <span title={c.createdAt}>{new Date(c.createdAt).toLocaleDateString()}</span>
          </div>
          <p className="mt-1.5 line-clamp-3 text-xs text-body">{c.content}</p>
          {c.conversationId ? (
            <Link
              href={`/${locale}/${ws}/conversations/${c.conversationId}`}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-violet-500 hover:text-violet-400"
            >
              {t("detail.openConversation")}
              <ExternalLink className="h-3 w-3" />
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
