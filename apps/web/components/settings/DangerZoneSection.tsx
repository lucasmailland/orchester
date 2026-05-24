"use client";

import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { SoftDeleteWorkspaceModal } from "@/components/workspace/SoftDeleteWorkspaceModal";

interface Props {
  workspace: { id: string; name: string; slug: string; role: string };
}

/**
 * Settings → Danger Zone.
 *
 * Phase E swap: delete now goes through `SoftDeleteWorkspaceModal`,
 * which hits the new slug-keyed soft-delete endpoint and surfaces the
 * one-shot restore token. Only the workspace `owner` can trigger it;
 * the server re-enforces.
 */
export function DangerZoneSection({ workspace }: Props) {
  const t = useTranslations("pages.settings.danger");
  const isOwner = workspace.role === "owner";
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
      <header className="mb-4 flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
          <AlertTriangle size={16} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">{t("title")}</h2>
          <p className="text-xs text-muted">{t("description")}</p>
        </div>
      </header>

      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!isOwner}
        title={isOwner ? "" : t("onlyOwner")}
        className="btn-danger"
      >
        <Trash2 size={14} />
        {t("deleteButton")}
      </button>
      {!isOwner && (
        <p className="mt-2 text-[11px] text-muted">
          {t.rich("yourRoleIs", {
            role: workspace.role,
            b: (chunks) => <strong className="text-body">{chunks}</strong>,
          })}
        </p>
      )}

      <SoftDeleteWorkspaceModal
        open={open}
        onClose={() => setOpen(false)}
        workspace={{ name: workspace.name, slug: workspace.slug }}
      />
    </section>
  );
}
