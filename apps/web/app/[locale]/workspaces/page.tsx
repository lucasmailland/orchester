"use client";
import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMyWorkspaces } from "@/components/workspace/hooks/useMyWorkspaces";
import { WorkspaceAvatar } from "@/components/workspace/WorkspaceAvatar";
import { CreateWorkspaceModal } from "@/components/workspace/CreateWorkspaceModal";

/**
 * `/[locale]/workspaces` — no-context landing.
 *
 * Reached when the user is signed in but doesn't have an active
 * workspace (no cookie, or the cookie's slug 404'd). Also where the
 * Phase D middleware redirects users without a cookie when they hit
 * a legacy URL.
 *
 * Lives OUTSIDE the `[workspaceSlug]` segment by design — the whole
 * point is that there is no workspace yet.
 */
export default function WorkspacesPage() {
  const t = useTranslations("workspace.listPage");
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "en";
  const { workspaces, isLoading } = useMyWorkspaces();
  const [createOpen, setCreateOpen] = useState(false);

  if (isLoading) return <div className="p-10 text-muted">…</div>;

  async function go(slug: string) {
    // Use the signed-cookie endpoint instead of writing the cookie
    // directly: middleware now rejects unsigned values and would loop
    // us right back here. Server endpoint applies the HMAC tag.
    try {
      await fetch("/api/me/active-workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      });
    } catch {
      // Best-effort; if it fails we'll redirect-loop and the user
      // can try again.
    }
    router.push(`/${locale}/${slug}`);
  }

  return (
    <div className="mx-auto max-w-2xl p-10">
      <h1 className="mb-6 font-display text-2xl font-bold text-strong">{t("title")}</h1>
      <div className="space-y-2">
        {workspaces.map((ws) => (
          <button
            key={ws.id}
            type="button"
            onClick={() => go(ws.slug)}
            className="flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-4 text-left hover:border-violet-500/40"
          >
            <WorkspaceAvatar name={ws.name} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-strong">{ws.name}</div>
              <div className="text-xs text-muted">
                {ws.slug} · {ws.role}
              </div>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-faint">{ws.status}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-card py-4 text-sm text-muted hover:border-violet-500/40 hover:text-body"
      >
        <Plus className="h-4 w-4" /> {t("createNew")}
      </button>

      {createOpen && <CreateWorkspaceModal onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
