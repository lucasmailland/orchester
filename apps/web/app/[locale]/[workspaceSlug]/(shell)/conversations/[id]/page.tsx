// Conversation detail (thread) view.
//
// Deep-link target for fact citations in the brain graph: the
// CitationsList "open conversation" link points here
// (/conversations/<id>#message-<msgId>). Before this route existed the
// link 404'd. Server-rendered so the #message-<id> anchor is present in the
// initial HTML and the browser scrolls to it on load; the cited message is
// highlighted via CSS :target.
//
// Mirrors the workspace-scoped query in GET /api/conversations/[id] (the
// data layer already existed — only the page was missing). RBAC: access is
// gated by getCurrentWorkspaceBySlug (returns null when the caller isn't a
// member → notFound).

import { getDb, schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Bot, User, Cog } from "lucide-react";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const ROLE_ICON = { user: User, assistant: Bot, system: Cog } as const;

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; id: string }>;
}) {
  const { locale, workspaceSlug, id } = await params;
  const ws = await getCurrentWorkspaceBySlug(workspaceSlug);
  if (!ws) notFound();

  const db = getDb();
  const convs = await db
    .select()
    .from(schema.conversations)
    .where(
      and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ws.workspace.id))
    )
    .limit(1);
  const conv = convs[0];
  if (!conv) notFound();

  const messages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, id))
    .orderBy(schema.messages.createdAt);

  const t = await getTranslations({ locale, namespace: "pages.conversations" });
  // next-intl's `t` wants literal keys (not a built string), so map statuses up front.
  const STATUS_LABEL: Record<"open" | "closed" | "escalated", string> = {
    open: t("status.open"),
    closed: t("status.closed"),
    escalated: t("status.escalated"),
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      {/* Highlight the cited message when arrived via #message-<id>. */}
      <style>{`[id^="message-"]:target{outline:2px solid rgb(139 92 246);outline-offset:3px;border-radius:0.75rem}`}</style>

      <Link
        href={`/${locale}/${workspaceSlug}/conversations`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-faint transition-colors hover:text-body"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("title")}
      </Link>

      <header className="mt-3 border-b border-line pb-4">
        <h1 className="text-lg font-semibold text-body">{conv.summary || t("title")}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-faint">
          <span className="rounded-md border border-line bg-card px-1.5 py-0.5 uppercase tracking-wider">
            {STATUS_LABEL[conv.status]}
          </span>
          <span className="tabular-nums">
            {messages.length} {t("messages")}
          </span>
          <span className="tabular-nums">{new Date(conv.startedAt).toLocaleString(locale)}</span>
        </div>
      </header>

      <div className="mt-4 space-y-2.5">
        {messages.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-card p-8 text-center text-sm text-faint">
            {t("empty")}
          </p>
        ) : (
          messages.map((m) => {
            const Icon = ROLE_ICON[m.role as keyof typeof ROLE_ICON] ?? Cog;
            return (
              <div
                key={m.id}
                id={`message-${m.id}`}
                className="scroll-mt-24 rounded-xl border border-line bg-card p-4"
              >
                <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-faint">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon className="h-3 w-3" />
                    {m.role}
                    {m.fromOperator ? (
                      <span className="rounded bg-violet-500/15 px-1 py-px text-violet-400">
                        op
                      </span>
                    ) : null}
                  </span>
                  <span title={new Date(m.createdAt).toISOString()}>
                    {new Date(m.createdAt).toLocaleString(locale)}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-body">
                  {m.content}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
