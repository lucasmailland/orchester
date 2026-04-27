"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft, Bot, Pencil, Trash2, Radio, Globe, MessageCircle,
  Send, ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { APPLE_EASE, staggerContainer, staggerItem } from "@/lib/motion";
import { TeamFormModal } from "./TeamFormModal";

const STATUS_DOT: Record<string, string> = {
  active: "bg-emerald-400",
  inactive: "bg-zinc-600",
  draft: "bg-amber-400",
};

const STATUS_LABEL: Record<string, string> = {
  active: "text-emerald-400",
  inactive: "text-zinc-500",
  draft: "text-amber-400",
};

const MODEL_SHORT: Record<string, string> = {
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-opus-4-7": "Opus 4.7",
  "claude-haiku-4-5": "Haiku 4.5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
};

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  web: <Globe size={14} />,
  whatsapp: <MessageCircle size={14} />,
  telegram: <Send size={14} />,
};

const CHANNEL_COLORS: Record<string, string> = {
  web: "#8b5cf6",
  whatsapp: "#25d366",
  telegram: "#0088cc",
};

interface Agent {
  id: string;
  name: string;
  role: string;
  model: string;
  status: string;
  systemPrompt: string;
  createdAt: Date;
}

interface Channel {
  id: string;
  name: string;
  type: string;
  status: string;
}

interface Team {
  id: string;
  name: string;
  description: string | null;
  avatarColor: string | null;
}

interface Labels {
  agents: string;
  editTeam: string;
  deleteTeam: string;
  back: string;
  confirmDelete: string;
  teamFormLabels: {
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
  locale: string;
}

interface TeamDetailClientProps {
  team: Team;
  agents: Agent[];
  channels: Channel[];
  labels: Labels;
}

export function TeamDetailClient({ team, agents, channels, labels }: TeamDetailClientProps) {
  const router = useRouter();
  const color = team.avatarColor ?? "#7C3AED";
  const initials = team.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const [editTeamOpen, setEditTeamOpen] = useState(false);

  async function deleteTeam() {
    if (!confirm(labels.confirmDelete)) return;
    await fetch(`/api/teams/${team.id}`, { method: "DELETE" });
    router.back();
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link
        href=".."
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <ArrowLeft size={14} />
        {labels.back}
      </Link>

      {/* Team header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: APPLE_EASE }}
        className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03]"
      >
        <div
          className="h-[2px] w-full"
          style={{ background: `linear-gradient(90deg, ${color}80, ${color}20, transparent)` }}
        />
        <div className="flex items-start justify-between p-6">
          <div className="flex items-center gap-4">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-lg"
              style={{ backgroundColor: color }}
            >
              {initials}
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-zinc-100">{team.name}</h1>
              {team.description && (
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-zinc-500">{team.description}</p>
              )}
              <div className="mt-2 flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Bot size={12} className="text-zinc-600" />
                  <span className="font-semibold text-zinc-300">{agents.length}</span> {labels.agents}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Radio size={12} className="text-zinc-600" />
                  <span className="font-semibold text-zinc-300">{channels.length}</span> canales
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditTeamOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
            >
              <Pencil size={13} />
              {labels.editTeam}
            </button>
            <button
              onClick={deleteTeam}
              className="flex items-center gap-1.5 rounded-xl border border-red-500/20 px-3 py-2 text-xs text-red-500/70 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 size={13} />
              {labels.deleteTeam}
            </button>
          </div>
        </div>
      </motion.div>

      {/* Two-column layout */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Agents — spans 2 cols */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
              Agentes del equipo
            </h2>
            <Link
              href={`/${labels.locale}/agents`}
              className="flex items-center gap-1 text-[11px] text-zinc-600 transition-colors hover:text-violet-400"
            >
              Gestionar agentes
              <ExternalLink size={10} />
            </Link>
          </div>

          {agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/[0.08] py-10 text-center">
              <Bot size={20} className="text-zinc-700" />
              <p className="text-xs text-zinc-600">Este equipo no tiene agentes.</p>
              <Link
                href={`/${labels.locale}/agents`}
                className="rounded-lg bg-violet-600/20 px-3 py-1.5 text-xs font-medium text-violet-400 hover:bg-violet-600/30"
              >
                Ir a Agentes →
              </Link>
            </div>
          ) : (
            <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
              {agents.map((agent) => (
                <motion.div
                  key={agent.id}
                  variants={staggerItem}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3"
                >
                  {/* Status indicator */}
                  <span className="relative flex h-2 w-2 shrink-0">
                    {agent.status === "active" && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                    )}
                    <span className={cn("relative inline-flex h-2 w-2 rounded-full", STATUS_DOT[agent.status] ?? "bg-zinc-600")} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-100">{agent.name}</p>
                    <p className="truncate text-xs text-zinc-600">{agent.role}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded border border-zinc-700/50 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                      {MODEL_SHORT[agent.model] ?? agent.model}
                    </span>
                    <span className={cn("text-[10px] font-semibold uppercase tracking-wide", STATUS_LABEL[agent.status] ?? "text-zinc-500")}>
                      {agent.status}
                    </span>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>

        {/* Channels — 1 col */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
              Canales conectados
            </h2>
            <Link
              href={`/${labels.locale}/channels`}
              className="flex items-center gap-1 text-[11px] text-zinc-600 transition-colors hover:text-violet-400"
            >
              Ver canales
              <ExternalLink size={10} />
            </Link>
          </div>

          {channels.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.08] py-8 text-center">
              <Radio size={18} className="text-zinc-700" />
              <p className="text-xs text-zinc-600">Sin canales activos.</p>
            </div>
          ) : (
            <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
              {channels.map((ch) => {
                const chColor = CHANNEL_COLORS[ch.type] ?? "#94a3b8";
                const chIcon = CHANNEL_ICONS[ch.type] ?? <Radio size={14} />;
                return (
                  <motion.div
                    key={ch.id}
                    variants={staggerItem}
                    className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3"
                  >
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${chColor}1a`, color: chColor }}
                    >
                      {chIcon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-200">{ch.name}</p>
                      <p className="text-[10px] capitalize text-zinc-600">{ch.type}</p>
                    </div>
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        ch.status === "active" ? "bg-emerald-400" : "bg-zinc-600"
                      )}
                    />
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>
      </div>

      {/* Team edit modal */}
      <TeamFormModal
        open={editTeamOpen}
        onClose={() => setEditTeamOpen(false)}
        initial={team}
        labels={labels.teamFormLabels}
      />
    </div>
  );
}
