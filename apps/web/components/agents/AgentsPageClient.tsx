"use client";

import { useState, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { confirm } from "@/components/ui/ConfirmDialog";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Plus, Pencil, Trash2, Zap, Filter } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { AgentFormModal } from "./AgentFormModal";
import { NoProviderBanner } from "@/components/common/NoProviderBanner";

const STATUS_CONFIG = {
  active: {
    dot: "bg-emerald-400",
    ping: true,
    label: "text-emerald-600 dark:text-emerald-400",
    badge: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  inactive: {
    dot: "bg-zinc-600",
    ping: false,
    label: "text-muted",
    badge: "border-zinc-700/50 bg-elevated/50 text-muted",
  },
  draft: {
    dot: "bg-amber-400",
    ping: true,
    label: "text-amber-600 dark:text-amber-400",
    badge: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
};

const MODEL_SHORT: Record<string, string> = {
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-opus-4-7": "Opus 4.7",
  "claude-haiku-4-5": "Haiku 4.5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
};

const MODEL_COLOR: Record<string, string> = {
  "claude-sonnet-4-6": "#8b5cf6",
  "claude-opus-4-7": "#6d28d9",
  "claude-haiku-4-5": "#a78bfa",
  "claude-haiku-4-5-20251001": "#a78bfa",
};

function getModelColor(model: string) {
  if (model.includes("opus")) return "#6d28d9";
  if (model.includes("haiku")) return "#a78bfa";
  if (model.includes("sonnet")) return "#8b5cf6";
  return MODEL_COLOR[model] ?? "#94a3b8";
}

interface AgentItem {
  id: string;
  name: string;
  role: string;
  model: string;
  status: "active" | "inactive" | "draft";
  systemPrompt: string | null;
  teamId: string | null;
  teamName: string | null;
}

interface TeamOption {
  id: string;
  name: string;
  avatarColor: string | null;
}

interface AgentsPageClientProps {
  agents: AgentItem[];
  teams: TeamOption[];
}

type FilterStatus = "all" | "active" | "inactive" | "draft";

export function AgentsPageClient({ agents, teams }: AgentsPageClientProps) {
  const router = useRouter();
  const t = useTranslations("pages.agents");
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "es";
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentItem | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("all");

  const AGENT_LABELS = {
    createTitle: t("form.createTitle"),
    editTitle: t("form.editTitle"),
    nameLabel: t("form.nameLabel"),
    roleLabel: t("form.roleLabel"),
    promptLabel: t("form.promptLabel"),
    modelLabel: t("form.modelLabel"),
    statusLabel: t("form.statusLabel"),
    teamLabel: t("form.teamLabel"),
    save: t("form.save"),
    cancel: t("form.cancel"),
  };

  const filtered = useMemo(
    () => (filter === "all" ? agents : agents.filter((a) => a.status === filter)),
    [agents, filter]
  );

  // Group by team
  const grouped = useMemo(() => {
    const map = new Map<
      string,
      { teamName: string; teamColor: string | null; agents: AgentItem[] }
    >();
    for (const agent of filtered) {
      const key = agent.teamId ?? "__none__";
      const label = agent.teamName ?? t("noTeam");
      const color = teams.find((t) => t.id === agent.teamId)?.avatarColor ?? null;
      if (!map.has(key)) map.set(key, { teamName: label, teamColor: color, agents: [] });
      map.get(key)!.agents.push(agent);
    }
    return Array.from(map.entries()).map(([key, val]) => ({ key, ...val }));
  }, [filtered, teams, t]);

  async function handleDelete(agentId: string) {
    const ok = await confirm({
      title: t("deleteAgent"),
      description: t("deleteAgentDescription"),
      confirmText: t("deleteConfirm"),
      destructive: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/agents/${agentId}`, { method: "DELETE" });
    if (r.ok) {
      toast.success(t("agentDeleted"));
      router.refresh();
    } else {
      toast.error(t("agentDeleteError"));
    }
  }

  const FILTERS: { value: FilterStatus; label: string; count: number }[] = [
    { value: "all", label: t("filters.all"), count: agents.length },
    {
      value: "active",
      label: t("filters.active"),
      count: agents.filter((a) => a.status === "active").length,
    },
    {
      value: "draft",
      label: t("filters.draft"),
      count: agents.filter((a) => a.status === "draft").length,
    },
    {
      value: "inactive",
      label: t("filters.inactive"),
      count: agents.filter((a) => a.status === "inactive").length,
    },
  ];

  return (
    <div className="space-y-6">
      <NoProviderBanner />
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-strong">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-opacity hover:opacity-90"
        >
          <Plus size={15} />
          {t("newAgent")}
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2">
        <Filter size={13} className="text-faint" />
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              filter === f.value
                ? "bg-violet-600/20 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30"
                : "text-muted hover:bg-hover hover:text-body"
            )}
          >
            {f.label}
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 font-mono text-[10px]",
                filter === f.value
                  ? "bg-violet-500/20 text-violet-700 dark:text-violet-300"
                  : "bg-elevated text-faint"
              )}
            >
              {f.count}
            </span>
          </button>
        ))}
      </div>

      {/* Empty */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-line py-16">
          <Bot size={24} className="text-faint" />
          <p className="text-sm text-faint">{t("noAgentsToShow")}</p>
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded-xl bg-violet-600/20 px-4 py-2 text-sm font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-600/30"
          >
            {t("createFirstAgent")}
          </button>
        </div>
      )}

      {/* Grouped sections */}
      <AnimatePresence mode="wait">
        <div className="space-y-8">
          {grouped.map((group) => (
            <div key={group.key}>
              {/* Team section header */}
              <div className="mb-3 flex items-center gap-3">
                {group.teamColor && (
                  <div
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: group.teamColor }}
                  />
                )}
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted">
                  {group.teamName}
                </h2>
                <div className="flex-1 border-t border-line" />
                <span className="font-mono text-[10px] text-faint">
                  {group.agents.length} {group.agents.length === 1 ? t("agent") : t("agents")}
                </span>
              </div>

              {/* Agent cards grid */}
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
              >
                {group.agents.map((agent) => {
                  const s = STATUS_CONFIG[agent.status];
                  const modelColor = getModelColor(agent.model);

                  return (
                    <motion.div
                      key={agent.id}
                      variants={staggerItem}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("button")) return;
                        router.push(`/${locale}/agents/${agent.id}`);
                      }}
                      className={cn(
                        "group relative cursor-pointer overflow-hidden rounded-2xl border border-line bg-card",
                        "transition-all hover:border-violet-500/30 hover:bg-hover"
                      )}
                    >
                      {/* Left color bar */}
                      <div
                        className="absolute left-0 inset-y-0 w-[3px]"
                        style={{ backgroundColor: modelColor + "80" }}
                      />

                      <div className="p-4 pl-5">
                        {/* Top row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600/15 text-violet-600 dark:text-violet-400">
                              <Bot size={15} />
                              <span className="absolute -bottom-0.5 -right-0.5">
                                <span className="relative flex h-2.5 w-2.5">
                                  {s.ping && (
                                    <span
                                      className={cn(
                                        "absolute inline-flex h-full w-full animate-ping rounded-full opacity-50",
                                        s.dot
                                      )}
                                    />
                                  )}
                                  <span
                                    className={cn(
                                      "relative inline-flex h-2.5 w-2.5 rounded-full",
                                      s.dot
                                    )}
                                  />
                                </span>
                              </span>
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-strong">
                                {agent.name}
                              </p>
                              <p className="truncate text-xs text-muted">{agent.role}</p>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              aria-label={t("editAria", { name: agent.name })}
                              onClick={() => setEditingAgent(agent)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-line hover:text-body"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              aria-label={t("deleteAria", { name: agent.name })}
                              onClick={() => handleDelete(agent.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        {/* System prompt preview */}
                        {agent.systemPrompt && (
                          <p className="mt-2.5 line-clamp-2 text-[11px] leading-relaxed text-faint">
                            {agent.systemPrompt}
                          </p>
                        )}

                        {/* Bottom badges */}
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <Zap size={9} style={{ color: modelColor }} />
                            <span
                              className="font-mono text-[10px]"
                              style={{ color: modelColor + "cc" }}
                            >
                              {MODEL_SHORT[agent.model] ?? agent.model}
                            </span>
                          </div>
                          <span
                            className={cn(
                              "rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              s.badge
                            )}
                          >
                            {t(`statusBadge.${agent.status}`)}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            </div>
          ))}
        </div>
      </AnimatePresence>

      {/* Modals */}
      <AgentFormModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          router.refresh();
        }}
        teamId={teams[0]?.id ?? ""}
        teams={teams}
        labels={AGENT_LABELS}
      />

      {editingAgent && (
        <AgentFormModal
          open
          onClose={() => {
            setEditingAgent(null);
            router.refresh();
          }}
          teamId={editingAgent.teamId ?? teams[0]?.id ?? ""}
          teams={teams}
          initial={{
            id: editingAgent.id,
            name: editingAgent.name,
            role: editingAgent.role,
            systemPrompt: editingAgent.systemPrompt ?? "",
            model: editingAgent.model,
            status: editingAgent.status,
          }}
          labels={AGENT_LABELS}
        />
      )}
    </div>
  );
}
