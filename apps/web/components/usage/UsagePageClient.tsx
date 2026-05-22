"use client";

import { motion } from "framer-motion";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fadeInDown, staggerContainer, staggerItem, APPLE_EASE } from "@/lib/motion";

const MODEL_SHORT: Record<string, string> = {
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-opus-4-7": "Opus 4.7",
  "claude-haiku-4-5": "Haiku 4.5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
};

const MODEL_COLOR: Record<string, string> = {
  "claude-sonnet-4-6": "text-violet-400 bg-violet-500/10 border-violet-500/25",
  "claude-opus-4-7": "text-blue-400 bg-blue-500/10 border-blue-500/25",
  "claude-haiku-4-5": "text-teal-400 bg-teal-500/10 border-teal-500/25",
  "claude-haiku-4-5-20251001": "text-teal-400 bg-teal-500/10 border-teal-500/25",
};

const KPI_STYLES = {
  primary:  { bg: "bg-card", border: "border-line", text: "text-strong", sub: "text-muted", icon: "text-blue-400" },
  accent:   { bg: "bg-violet-600", border: "border-violet-500/40", text: "text-white", sub: "text-violet-200/70", icon: "text-violet-100" },
  success:  { bg: "bg-blue-600", border: "border-blue-500/40", text: "text-white", sub: "text-blue-100/70", icon: "text-blue-100" },
  warning:  { bg: "bg-teal-600", border: "border-teal-500/40", text: "text-white", sub: "text-teal-100/70", icon: "text-teal-100" },
};

interface Kpi {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ReactNode;
  color: "primary" | "accent" | "success" | "warning";
}

interface AgentUsage {
  id: string;
  name: string;
  model: string;
  conversations: number;
  tokens: number;
  costUsd: number;
}

interface Labels {
  title: string;
  subtitle: string;
  chartTitle: string;
  agentTableTitle: string;
  noData: string;
  agent: string;
  model: string;
  conversations: string;
  tokens: string;
  cost: string;
}

interface UsagePageClientProps {
  kpis: Kpi[];
  tokensByDay: { date: string; tokens: number }[];
  agentUsage: AgentUsage[];
  labels: Labels;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function UsagePageClient({ kpis, tokensByDay, agentUsage, labels }: UsagePageClientProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";

  const gridColor = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)";
  const textColor = isDark ? "#52525b" : "#71717a";
  const maxTokens = Math.max(...tokensByDay.map(d => d.tokens), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div variants={fadeInDown} initial="hidden" animate="visible">
        <h1 className="font-display text-2xl font-bold tracking-tight text-strong">{labels.title}</h1>
        <p className="mt-1 text-sm text-muted">{labels.subtitle}</p>
      </motion.div>

      {/* KPI Cards */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        {kpis.map((kpi) => {
          const s = KPI_STYLES[kpi.color];
          return (
            <motion.div
              key={kpi.label}
              variants={staggerItem}
              whileHover={{ y: -3, transition: { duration: 0.18 } }}
              className={cn(
                "relative overflow-hidden rounded-2xl border p-5",
                s.bg, s.border
              )}
            >
              {/* decorative corner blob */}
              <div
                className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full opacity-20 blur-2xl"
                style={{ background: "currentColor" }}
              />
              <div className={cn("mb-2 flex items-center justify-between", s.icon)}>
                {kpi.icon}
                <span className={cn("text-[9px] font-bold uppercase tracking-widest", s.sub)}>
                  {kpi.label}
                </span>
              </div>
              <p className={cn("font-mono text-2xl font-bold leading-none", s.text)}>
                {kpi.value}
              </p>
              <p className={cn("mt-1.5 text-[11px]", s.sub)}>{kpi.sub}</p>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Token usage chart */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2, ease: APPLE_EASE }}
        className="rounded-2xl border border-white/[0.07] bg-card p-6"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-body">{labels.chartTitle}</h2>
          <span className="text-[10px] font-mono text-faint">LAST 30 DAYS</span>
        </div>
        <p className="mb-4 text-xs text-faint">Total tokens processed by all agents</p>

        {tokensByDay.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <p className="text-xs text-faint">{labels.noData}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={tokensByDay} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#7C3AED" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey="date"
                tick={{ fill: textColor, fontSize: 10, fontFamily: "var(--font-geist-mono)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) => {
                  const d = new Date(v);
                  return `${d.getMonth() + 1}/${d.getDate()}`;
                }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: textColor, fontSize: 10, fontFamily: "var(--font-geist-mono)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => formatTokens(v)}
                domain={[0, Math.ceil(maxTokens * 1.15)]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#18181b",
                  border: "1px solid rgba(124,58,237,0.2)",
                  borderRadius: "10px",
                  fontSize: "11px",
                  fontFamily: "var(--font-geist-mono)",
                  color: "#e4e4e7",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                }}
                labelFormatter={(v) => {
                  const d = new Date(String(v));
                  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                }}
                formatter={(v) => [formatTokens(Number(v)), "Tokens"]}
              />
              <Area
                type="monotone"
                dataKey="tokens"
                stroke="#7C3AED"
                strokeWidth={2}
                fill="url(#tokenGradient)"
                dot={false}
                activeDot={{ r: 4, fill: "#7C3AED", strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      {/* Agent usage table */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.35, ease: APPLE_EASE }}
        className="rounded-2xl border border-white/[0.07] bg-card"
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-6 py-4">
          <h2 className="font-display text-sm font-bold text-body">{labels.agentTableTitle}</h2>
          <span className="text-[10px] font-mono text-faint">ALL TIME</span>
        </div>

        {agentUsage.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-xs text-faint">{labels.noData}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {[labels.agent, labels.model, labels.conversations, labels.tokens, labels.cost].map(h => (
                    <th key={h} className="px-6 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-faint">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agentUsage.map((agent, idx) => {
                  const pct = Math.round((agent.tokens / (agentUsage[0]?.tokens || 1)) * 100);
                  return (
                    <tr
                      key={agent.id}
                      className="group border-b border-white/[0.04] transition-colors hover:bg-card"
                    >
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 font-mono text-[10px] font-bold text-violet-400">
                            {idx + 1}
                          </span>
                          <span className="font-medium text-body">{agent.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className={cn(
                          "rounded border px-2 py-0.5 font-mono text-[10px]",
                          MODEL_COLOR[agent.model] ?? "text-muted bg-surface border-zinc-700/50"
                        )}>
                          {MODEL_SHORT[agent.model] ?? agent.model}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 font-mono text-sm text-muted">
                        {agent.conversations.toLocaleString()}
                      </td>
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="h-1 w-20 overflow-hidden rounded-full bg-elevated">
                            <div
                              className="h-full rounded-full bg-violet-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="font-mono text-sm text-body">{formatTokens(agent.tokens)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3.5 font-mono text-sm text-emerald-400">
                        ${agent.costUsd.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}
