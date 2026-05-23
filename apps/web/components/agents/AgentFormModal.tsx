"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const MODELS = [
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-opus-4-7", label: "Opus 4.7" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

interface AgentFormModalProps {
  open: boolean;
  onClose: () => void;
  teamId: string;
  teams?: { id: string; name: string; avatarColor: string | null }[];
  initial?: {
    id: string;
    name: string;
    role: string;
    systemPrompt: string;
    model: string;
    status: string;
  };
  labels: {
    createTitle: string;
    editTitle: string;
    nameLabel: string;
    roleLabel: string;
    promptLabel: string;
    modelLabel: string;
    statusLabel: string;
    teamLabel?: string;
    save: string;
    cancel: string;
  };
}

export function AgentFormModal({
  open,
  onClose,
  teamId,
  teams,
  initial,
  labels,
}: AgentFormModalProps) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "");
  const [model, setModel] = useState(initial?.model ?? "claude-sonnet-4-6");
  const [status, setStatus] = useState(initial?.status ?? "draft");
  const [selectedTeamId, setSelectedTeamId] = useState(teamId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isEdit = !!initial;

  async function handleSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const url = isEdit ? `/api/agents/${initial.id}` : "/api/agents";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role, systemPrompt, model, status, teamId: selectedTeamId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.refresh();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  const inputClass = cn(
    "w-full rounded-xl border border-line bg-elevated px-3.5 py-2.5",
    "text-sm text-strong placeholder:text-faint",
    "outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/30",
    "transition-all"
  );

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
              className="w-full max-w-lg"
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
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted">{labels.nameLabel}</label>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="HR Assistant"
                        required
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted">{labels.roleLabel}</label>
                      <input
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        placeholder="HR Specialist"
                        required
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted">{labels.promptLabel}</label>
                    <textarea
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      placeholder="You are a helpful HR assistant that..."
                      required
                      rows={5}
                      className={cn(inputClass, "resize-none")}
                    />
                  </div>

                  {teams && teams.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted">
                        {labels.teamLabel ?? "Team"}
                      </label>
                      <select
                        value={selectedTeamId}
                        onChange={(e) => setSelectedTeamId(e.target.value)}
                        className={cn(inputClass, "cursor-pointer")}
                      >
                        {teams.map((t) => (
                          <option key={t.id} value={t.id} className="bg-surface">
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted">{labels.modelLabel}</label>
                      <select
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className={cn(inputClass, "cursor-pointer")}
                      >
                        {MODELS.map((m) => (
                          <option key={m.value} value={m.value} className="bg-surface">
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted">{labels.statusLabel}</label>
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className={cn(inputClass, "cursor-pointer")}
                      >
                        {STATUSES.map((s) => (
                          <option key={s.value} value={s.value} className="bg-surface">
                            {s.label}
                          </option>
                        ))}
                      </select>
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
