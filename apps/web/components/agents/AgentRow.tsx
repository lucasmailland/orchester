"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Bot, Pencil, Trash2 } from "lucide-react";
import { APPLE_EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AgentFormModal } from "./AgentFormModal";
import { toast } from "sonner";
import { confirm } from "@/components/ui/ConfirmDialog";

interface AgentRowProps {
  id: string;
  name: string;
  role: string;
  model: string;
  status: "active" | "inactive" | "draft";
  teamId: string | null;
  teamName: string | null;
  systemPrompt?: string;
  statusLabels: { active: string; inactive: string; draft: string };
  editable?: boolean;
}

const STATUS_CONFIG = {
  active: {
    dot: "bg-emerald-400",
    pulse: "bg-emerald-400",
    leftBorder: "border-l-emerald-500/40",
    label: "text-emerald-400",
  },
  inactive: {
    dot: "bg-zinc-600",
    pulse: null,
    leftBorder: "border-l-zinc-700/40",
    label: "text-zinc-500",
  },
  draft: {
    dot: "bg-amber-400",
    pulse: "bg-amber-400",
    leftBorder: "border-l-amber-500/40",
    label: "text-amber-400",
  },
};

const AGENT_LABELS = {
  createTitle: "Create Agent",
  editTitle: "Edit Agent",
  nameLabel: "Name",
  roleLabel: "Role",
  promptLabel: "System Prompt",
  modelLabel: "Model",
  statusLabel: "Status",
  save: "Save",
  cancel: "Cancel",
};

export function AgentRow({ id, name, role, model, status, teamId, teamName, systemPrompt, statusLabels, editable = false }: AgentRowProps) {
  const s = STATUS_CONFIG[status];
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);

  async function handleDelete() {
    const ok = await confirm({
      title: "Eliminar agente",
      description: "Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      destructive: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/agents/${id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("Agente eliminado");
      router.refresh();
    } else {
      toast.error("No se pudo eliminar");
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: APPLE_EASE }}
        whileHover={{ x: 2, transition: { duration: 0.15 } }}
        className={cn(
          "group relative flex items-center gap-4 rounded-xl border border-l-2 p-4",
          "border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.05]",
          "transition-colors duration-200",
          s.leftBorder
        )}
      >
        {/* Avatar with status dot */}
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600/15 text-violet-400">
          <Bot size={17} />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center">
            {s.pulse && (
              <span
                className={cn(
                  "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
                  s.pulse
                )}
              />
            )}
            <span className={cn("relative inline-flex h-2 w-2 rounded-full", s.dot)} />
          </span>
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-100">{name}</p>
          <p className="truncate text-xs text-zinc-500">{role}</p>
        </div>

        {/* Status label + model */}
        <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
          <span
            className={cn(
              "rounded-md border border-zinc-700/50 bg-zinc-900 px-2 py-0.5 font-mono text-[11px]",
              "text-zinc-400"
            )}
          >
            {model}
          </span>
          <div className="flex items-center gap-1.5">
            {teamName && (
              <span className="text-[11px] text-zinc-600">{teamName} ·</span>
            )}
            <span className={cn("text-[11px] font-medium", s.label)}>
              {statusLabels[status]}
            </span>
          </div>
        </div>

        {/* Edit/Delete actions */}
        {editable && (
          <div className="ml-2 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => setEditOpen(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-white/[0.07] hover:text-zinc-300 transition-colors"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={handleDelete}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </motion.div>

      {editable && teamId && (
        <AgentFormModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          teamId={teamId}
          initial={{ id, name, role, systemPrompt: systemPrompt ?? "", model, status }}
          labels={AGENT_LABELS}
        />
      )}
    </>
  );
}
