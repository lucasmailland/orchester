"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const COLORS = [
  "#7C3AED",
  "#3B3BFF",
  "#0EA5E9",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#6366F1",
];

interface TeamFormModalProps {
  open: boolean;
  onClose: () => void;
  initial?: { id: string; name: string; description: string | null; avatarColor: string | null };
  labels: {
    createTitle: string;
    editTitle: string;
    nameLabel: string;
    descriptionLabel: string;
    colorLabel: string;
    save: string;
    cancel: string;
    namePlaceholder: string;
    descriptionPlaceholder: string;
  };
}

export function TeamFormModal({ open, onClose, initial, labels }: TeamFormModalProps) {
  const router = useRouter();
  const t = useTranslations("pages.teams");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [color, setColor] = useState(initial?.avatarColor ?? COLORS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isEdit = !!initial;

  async function handleSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const url = isEdit ? `/api/teams/${initial.id}` : "/api/teams";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, avatarColor: color }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? t("genericError"));
        return;
      }
      router.refresh();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/75"
            onClick={onClose}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              key="modal"
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-md"
            >
              <div className="max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-violet-500/20 bg-surface shadow-2xl shadow-black/80 ring-1 ring-violet-500/10">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-line px-6 py-4">
                  <h2 className="font-display text-base font-bold text-strong">
                    {isEdit ? labels.editTitle : labels.createTitle}
                  </h2>
                  <button
                    onClick={onClose}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-body"
                  >
                    <X size={15} />
                  </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-5 p-6">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted">{labels.nameLabel}</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={labels.namePlaceholder}
                      required
                      className={cn(
                        "w-full rounded-xl border border-line bg-elevated px-3.5 py-2.5",
                        "text-sm text-strong placeholder:text-faint",
                        "outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/30",
                        "transition-all"
                      )}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted">
                      {labels.descriptionLabel}
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={labels.descriptionPlaceholder}
                      rows={3}
                      className={cn(
                        "w-full resize-none rounded-xl border border-line bg-elevated px-3.5 py-2.5",
                        "text-sm text-strong placeholder:text-faint",
                        "outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/30",
                        "transition-all"
                      )}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted">{labels.colorLabel}</label>
                    <div className="flex gap-2.5">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setColor(c)}
                          className={cn(
                            "h-7 w-7 rounded-lg transition-all",
                            color === c &&
                              "ring-2 ring-white/50 ring-offset-1 ring-offset-zinc-900 scale-110"
                          )}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>

                  {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-hover hover:text-body"
                    >
                      {labels.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-opacity disabled:opacity-60"
                    >
                      {loading ? "..." : labels.save}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
