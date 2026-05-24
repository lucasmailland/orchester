"use client";

import { useState } from "react";
import { AlertTriangle, Trash2, UserCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { SoftDeleteWorkspaceModal } from "@/components/workspace/SoftDeleteWorkspaceModal";
import { TransferOwnershipModal } from "@/components/workspace/TransferOwnershipModal";

interface Props {
  workspace: { id: string; name: string; slug: string; role: string };
}

/**
 * Settings → Danger Zone.
 *
 * Two owner-only actions:
 *   1. Transfer ownership — promote another member to owner and
 *      demote the caller to admin. Re-asks for the password.
 *   2. Soft-delete — moves the workspace into the 30-day restore
 *      window and surfaces a one-shot restore token.
 *
 * Both are gated client-side on `workspace.role === "owner"`; the
 * server endpoints re-enforce so a tampered button can't bypass it.
 */
export function DangerZoneSection({ workspace }: Props) {
  const t = useTranslations("pages.settings.danger");
  const tTransfer = useTranslations("workspace.transfer");
  const isOwner = workspace.role === "owner";
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

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

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTransferOpen(true)}
          disabled={!isOwner}
          title={isOwner ? "" : t("onlyOwner")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-elevated px-3 py-1.5 text-xs font-medium text-strong hover:bg-elevated/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <UserCog size={14} />
          {tTransfer("openButton")}
        </button>

        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          disabled={!isOwner}
          title={isOwner ? "" : t("onlyOwner")}
          className="btn-danger"
        >
          <Trash2 size={14} />
          {t("deleteButton")}
        </button>
      </div>
      {!isOwner && (
        <p className="mt-2 text-[11px] text-muted">
          {t.rich("yourRoleIs", {
            role: workspace.role,
            b: (chunks) => <strong className="text-body">{chunks}</strong>,
          })}
        </p>
      )}

      <SoftDeleteWorkspaceModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        workspace={{ name: workspace.name, slug: workspace.slug }}
      />
      {transferOpen && (
        <TransferOwnershipModal
          workspaceSlug={workspace.slug}
          workspaceName={workspace.name}
          onClose={() => setTransferOpen(false)}
        />
      )}
    </section>
  );
}
