"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Bot } from "lucide-react";
import { APPLE_EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { OrgTeam } from "@/lib/db-queries";

interface OrgChartProps {
  workspaceName: string;
  teams: OrgTeam[];
}

const STATUS_DOT: Record<string, string> = {
  active: "bg-emerald-400",
  inactive: "bg-zinc-600",
  draft: "bg-amber-400",
};

const STATUS_LABEL: Record<string, string> = {
  active: "text-emerald-400",
  inactive: "text-muted",
  draft: "text-amber-400",
};

const MODEL_SHORT: Record<string, string> = {
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-opus-4-7": "Opus 4.7",
  "claude-haiku-4-5": "Haiku 4.5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
};

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cy = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`;
}

function layoutRect(el: HTMLElement, container: HTMLElement) {
  let top = 0, left = 0;
  let cur: HTMLElement | null = el;
  while (cur && cur !== container) {
    top += cur.offsetTop;
    left += cur.offsetLeft;
    cur = cur.offsetParent as HTMLElement | null;
  }
  return { top, left, w: el.offsetWidth, h: el.offsetHeight };
}

export function OrgChart({ workspaceName, teams }: OrgChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const teamRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const agentRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [paths, setPaths] = useState<Array<{ d: string; key: string; tier: "ws" | "team" }>>([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });

  const compute = useCallback(() => {
    const container = containerRef.current;
    const wsEl = workspaceRef.current;
    if (!container || !wsEl) return;

    const ws = layoutRect(wsEl, container);
    const wsX = ws.left + ws.w / 2;
    const wsY = ws.top + ws.h;

    const next: typeof paths = [];

    for (const [teamId, teamEl] of teamRefs.current) {
      const t = layoutRect(teamEl, container);
      const tx = t.left + t.w / 2;
      next.push({ key: `ws-${teamId}`, tier: "ws", d: bezier(wsX, wsY, tx, t.top) });

      for (const [key, agentEl] of agentRefs.current) {
        if (!key.startsWith(teamId + ":")) continue;
        const a = layoutRect(agentEl, container);
        next.push({
          key: `${teamId}-${key}`,
          tier: "team",
          d: bezier(tx, t.top + t.h, a.left + a.w / 2, a.top),
        });
      }
    }

    setSvgSize({ w: container.scrollWidth, h: container.scrollHeight });
    setPaths(next);
  }, []);

  useEffect(() => {
    const id = setTimeout(compute, 80);
    const ro = new ResizeObserver(compute);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => { clearTimeout(id); ro.disconnect(); };
  }, [compute]);

  const totalAgents = teams.reduce((s, t) => s + t.agents.length, 0);

  return (
    <div ref={containerRef} className="relative w-full overflow-x-auto pb-12">
      {/* SVG connections */}
      <svg
        width={svgSize.w || "100%"}
        height={svgSize.h || 600}
        className="pointer-events-none absolute left-0 top-0"
        style={{ zIndex: 0 }}
      >
        <defs>
          <linearGradient id="og-ws" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B3BFF" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#7C3AED" stopOpacity={0.55} />
          </linearGradient>
          <linearGradient id="og-team" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#7C3AED" stopOpacity={0.15} />
          </linearGradient>
          <filter id="og-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {paths.map(({ d, key, tier }) => (
          <motion.path
            key={key}
            d={d}
            fill="none"
            stroke={tier === "ws" ? "url(#og-ws)" : "url(#og-team)"}
            strokeWidth={tier === "ws" ? 2 : 1.5}
            strokeDasharray={tier === "team" ? "5 4" : undefined}
            filter={tier === "ws" ? "url(#og-glow)" : undefined}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{
              pathLength: { duration: 0.75, delay: tier === "ws" ? 0.45 : 1.0, ease: "easeInOut" },
              opacity: { duration: 0.2, delay: tier === "ws" ? 0.45 : 1.0 },
            }}
          />
        ))}
      </svg>

      {/* Tree layout */}
      <div className="relative flex flex-col items-center gap-14 py-8" style={{ zIndex: 1 }}>

        {/* ── Workspace node ── */}
        <motion.div
          ref={workspaceRef}
          initial={{ opacity: 0, scale: 0.8, y: -16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.45, ease: APPLE_EASE }}
          whileHover={{ scale: 1.025, transition: { duration: 0.2 } }}
          className={cn(
            "flex items-center gap-5 rounded-2xl border px-8 py-5 cursor-default",
            "border-violet-500/25 bg-gradient-to-br from-violet-600/10 via-zinc-950 to-blue-600/8",
            "shadow-[0_0_48px_rgba(124,58,237,0.18)]"
          )}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-blue-600 shadow-lg shadow-violet-500/30">
            <span className="text-lg font-bold text-white">O</span>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-400/70">
              Workspace
            </p>
            <p className="text-lg font-bold text-strong">{workspaceName}</p>
          </div>
          <div className="ml-2 flex items-center gap-5 border-l border-line pl-5">
            <div className="text-center">
              <p className="text-2xl font-bold tabular-nums text-violet-400">{teams.length}</p>
              <p className="text-[10px] font-medium uppercase tracking-widest text-muted">Teams</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold tabular-nums text-blue-400">{totalAgents}</p>
              <p className="text-[10px] font-medium uppercase tracking-widest text-muted">Agents</p>
            </div>
          </div>
        </motion.div>

        {/* ── Teams row ── */}
        <div className="flex flex-wrap justify-center gap-10">
          {teams.map((team, ti) => {
            const color = team.avatarColor ?? "#3B3BFF";
            const initials = team.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

            return (
              <div key={team.id} className="flex flex-col items-center gap-5">

                {/* Team card */}
                <motion.div
                  ref={el => { if (el) teamRefs.current.set(team.id, el); }}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.25 + ti * 0.1, ease: APPLE_EASE }}
                  whileHover={{ y: -4, transition: { duration: 0.18 } }}
                  className="w-56 cursor-default rounded-2xl border bg-card p-4 shadow-lg"
                  style={{
                    borderColor: `${color}45`,
                    boxShadow: `0 4px 28px ${color}1A`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-md"
                      style={{ backgroundColor: color }}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-strong">
                        {team.name}
                      </p>
                      <p className="text-[11px] text-muted">
                        {team.agents.length} agent{team.agents.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  {team.description && (
                    <p className="mt-2.5 line-clamp-2 text-[11px] leading-relaxed text-muted">
                      {team.description}
                    </p>
                  )}
                </motion.div>

                {/* Agent cards */}
                <div className="flex flex-col gap-2.5">
                  {team.agents.map((agent, ai) => (
                    <motion.div
                      key={agent.id}
                      ref={el => { if (el) agentRefs.current.set(`${team.id}:${agent.id}`, el); }}
                      initial={{ opacity: 0, y: 18 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.38, delay: 0.65 + ti * 0.1 + ai * 0.07, ease: APPLE_EASE }}
                      whileHover={{ y: -2, scale: 1.015, transition: { duration: 0.15 } }}
                      className="w-56 cursor-default rounded-xl border border-line bg-card p-3"
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                          style={{ backgroundColor: `${color}18`, color }}
                        >
                          <Bot size={13} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-semibold text-body">
                            {agent.name}
                          </p>
                          <p className="truncate text-[10px] text-muted">{agent.role}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[agent.status] ?? "bg-zinc-600")} />
                          <span className={cn("text-[9px] font-semibold uppercase", STATUS_LABEL[agent.status] ?? "text-muted")}>
                            {agent.status}
                          </span>
                        </div>
                      </div>
                      <span className="mt-2 inline-block rounded border border-zinc-700/50 bg-surface px-1.5 py-0.5 font-mono text-[9px] text-muted">
                        {MODEL_SHORT[agent.model] ?? agent.model}
                      </span>
                    </motion.div>
                  ))}
                </div>

              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
