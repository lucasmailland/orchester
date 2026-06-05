// apps/web/components/workspace/TransferOwnershipModal.tsx
//
// Owner-only modal that drives `POST /api/workspaces/[slug]/transfer`.
// Used from Settings → Danger Zone.
//
// Three guardrails before POSTing:
//   1. The caller must pick a new owner from the existing
//      admin/editor/viewer members (not themselves; not the current
//      owner). We fetch the eligible list via `/api/workspace-members`
//      and filter out anyone with role `owner`.
//   2. The caller must re-enter their password — the server
//      re-verifies via better-auth, defending against a session-hijack
//      attacker triggering ownership transfer.
//   3. The caller must explicitly acknowledge the role demotion: once
//      the transfer lands they become an admin and will need to log in
//      again on the next session refresh.
//
// All three are enforced server-side too; UX guards are belt-and-
// suspenders.
"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, X } from "lucide-react";
import useSWR from "swr";
import { notify } from "@/lib/toast";

interface Member {
  userId: string;
  role: "owner" | "admin" | "editor" | "viewer";
  joinedAt: string;
  name: string;
  email: string;
  image: string | null;
}

interface MembersResponse {
  members: Member[];
  callerRole?: Member["role"];
}

interface TransferErrorBody {
  error?: string;
  retryAfter?: number;
}

async function fetcher(url: string): Promise<MembersResponse> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("members_fetch_failed");
  return (await r.json()) as MembersResponse;
}

export function TransferOwnershipModal({
  workspaceSlug,
  workspaceName,
  onClose,
  onSuccess,
}: {
  workspaceSlug: string;
  workspaceName: string;
  onClose: () => void;
  onSuccess?: () => void;
}): React.ReactElement {
  const t = useTranslations("workspace.transfer");
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "en";

  // We pull from the existing `/api/workspace-members` endpoint and
  // filter client-side. There's no slug-scoped variant — the route
  // resolves the workspace from the active-workspace cookie, which is
  // fine because Danger Zone always renders inside that workspace's
  // shell.
  const { data, isLoading } = useSWR<MembersResponse>("/api/workspace-members", fetcher, {
    revalidateOnFocus: false,
  });

  const eligibleMembers = (data?.members ?? []).filter((m) => m.role !== "owner");

  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [password, setPassword] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const canSubmit = !busy && selectedUserId !== "" && password.length > 0 && ack;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/workspaces/${workspaceSlug}/transfer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newOwnerId: selectedUserId, password }),
      });
      const j = (await r.json().catch(() => ({}))) as TransferErrorBody;
      if (!r.ok) {
        // Map known server errors to translated strings; fall back to
        // the raw `error` slug so unknown failures still surface.
        if (j.error === "rate_limited") {
          const retryAfterHeader = r.headers.get("retry-after");
          const seconds = retryAfterHeader ? Number(retryAfterHeader) : 60;
          const minutes = Math.max(1, Math.ceil(seconds / 60));
          notify.error(t("rateLimited", { minutes }));
        } else if (j.error === "password_invalid") {
          notify.error(t("passwordInvalid"));
        } else if (j.error === "same_owner") {
          notify.error(t("sameOwner"));
        } else if (j.error === "new_owner_not_a_member") {
          notify.error(t("notAMember"));
        } else {
          notify.error(j.error ?? t("genericError"));
        }
        setBusy(false);
        return;
      }
      notify.success(t("transferred"));
      onSuccess?.();
      onClose();
      // The caller's role is now `admin`; refresh the route so the
      // settings page re-evaluates ownership-only sections (incl.
      // Danger Zone itself, which the new admin can no longer use).
      router.refresh();
      router.push(`/${locale}/${workspaceSlug}/settings`);
    } catch {
      notify.error(t("genericError"));
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        key="transfer-bd"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <motion.div
        key="transfer-md"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <form
          onSubmit={submit}
          role="dialog"
          aria-modal="true"
          aria-labelledby="transfer-ownership-title"
          className="w-full max-w-md rounded-2xl border border-line bg-surface shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 id="transfer-ownership-title" className="text-sm font-bold text-strong">
              {t("title")}
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="text-muted hover:text-strong disabled:opacity-50"
              aria-label={t("cancel")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3 p-5">
            <p className="text-xs text-muted">{t("intro", { name: workspaceName })}</p>

            <div>
              <label
                htmlFor="transfer-new-owner"
                className="block text-[11px] uppercase tracking-wide text-muted"
              >
                {t("selectMember")}
              </label>
              {isLoading ? (
                <div className="mt-1 flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-2 text-xs text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("loadingMembers")}
                </div>
              ) : eligibleMembers.length === 0 ? (
                <p className="mt-1 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                  {t("noEligible")}
                </p>
              ) : (
                <select
                  id="transfer-new-owner"
                  required
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none"
                >
                  <option value="">{t("selectPlaceholder")}</option>
                  {eligibleMembers.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name} ({m.email}) · {m.role}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label
                htmlFor="transfer-password"
                className="block text-[11px] uppercase tracking-wide text-muted"
              >
                {t("passwordLabel")}
              </label>
              <input
                id="transfer-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none"
              />
              <p className="mt-1 text-[10px] text-faint">{t("passwordHint")}</p>
            </div>

            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-elevated/50 px-3 py-2 text-[11px] text-body">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5"
              />
              <span>{t("ackLabel")}</span>
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-line px-3 py-1.5 text-xs"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={!canSubmit || eligibleMembers.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {busy ? t("submitting") : t("submit")}
            </button>
          </div>
        </form>
      </motion.div>
    </AnimatePresence>
  );
}
