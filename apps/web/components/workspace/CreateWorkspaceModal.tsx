"use client";
import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useMyWorkspaces } from "./hooks/useMyWorkspaces";

/**
 * Slugify a free-form workspace name into something that satisfies the
 * canonical slug regex: `^[a-z][a-z0-9-]{2,38}[a-z0-9]$`. We
 * NFD-normalize first so accented characters fold to their ASCII base
 * (e.g. "Café" -> "cafe" not "caf-"), then strip leading/trailing
 * hyphens and clip to 40 chars (regex max). The user can still edit
 * the field afterwards if they want a custom slug.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Modal for creating a new workspace.
 *
 * Auto-derives the slug from the name on each keystroke (until the
 * user manually edits the slug, at which point we stop overwriting it
 * — `slugDirty` tracks that). Using a controlled handler instead of a
 * `useEffect([name])` so the slug update happens synchronously and we
 * don't fight React strict-mode's double-invoke. POST then optimistic
 * refresh + router.push so the new workspace is immediately active.
 */
export function CreateWorkspaceModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("workspace.create");
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "en";
  const { refresh } = useMyWorkspaces();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [busy, setBusy] = useState(false);

  function onNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setName(v);
    if (!slugDirty) setSlug(slugify(v));
  }

  function onSlugChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSlug(e.target.value);
    setSlugDirty(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/workspaces", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ name, slug, timezone }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) {
        if (j.error === "workspace_slug_taken") toast.error("Slug already taken");
        else toast.error(j.error ?? "Error creating workspace");
        setBusy(false);
        return;
      }
      toast.success(t("created"));
      // POST /api/workspaces already wrote the signed active-workspace
      // cookie on this response (see route handler). Writing it again
      // from the client would produce an UNSIGNED value that the
      // middleware now rejects — the server-side write is the truth.
      await refresh();
      router.push(`/${locale}/${slug}`);
    } catch {
      toast.error("Network error");
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        key="bd"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60"
        onClick={onClose}
      />
      <motion.div
        key="md"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <form
          onSubmit={submit}
          className="w-full max-w-md rounded-2xl border border-line bg-surface shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-sm font-bold text-strong">{t("title")}</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-muted hover:text-strong"
              aria-label={t("cancel")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3 p-5">
            <div>
              <label className="block text-[11px] text-muted">{t("nameLabel")}</label>
              <input
                autoFocus
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={onNameChange}
                className="mt-1 w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-muted">{t("slugLabel")}</label>
              <input
                required
                pattern="^[a-z][a-z0-9-]{2,38}[a-z0-9]$"
                value={slug}
                onChange={onSlugChange}
                className="mt-1 w-full rounded-lg border border-line bg-elevated px-3 py-2 font-mono text-xs text-strong outline-none"
              />
              <p className="mt-1 text-[10px] text-faint">{t("slugHint")}</p>
            </div>
            <div>
              <label className="block text-[11px] text-muted">{t("timezoneLabel")}</label>
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-elevated px-3 py-2 text-xs text-strong outline-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line px-3 py-1.5 text-xs"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={busy || !name || !slug}
              className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-50"
            >
              {t("submit")}
            </button>
          </div>
        </form>
      </motion.div>
    </AnimatePresence>
  );
}
