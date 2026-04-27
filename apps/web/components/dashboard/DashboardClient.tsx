"use client";

import { motion } from "framer-motion";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart,
} from "recharts";
import {
  Bot, MessageSquare, Users, Clock, Zap, DollarSign, BarChart3,
  Activity, TrendingUp, TrendingDown,
} from "lucide-react";
import { KpiCard } from "./KpiCard";
import { cn } from "@/lib/utils";
import type { FullDashboardStats } from "@/lib/db-queries";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDate(s: string) {
  const d = new Date(s + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDuration(s: number) {
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

const TOOLTIP_STYLE = {
  backgroundColor: "#18181b",
  border: "1px solid rgba(139,92,246,0.2)",
  borderRadius: "10px",
  fontSize: "11px",
  fontFamily: "var(--font-geist-mono, monospace)",
  color: "#e4e4e7",
  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
};

const GRID_COLOR = "rgba(255,255,255,0.04)";
const AXIS_COLOR = "#3f3f46";

const MODEL_COLORS: Record<string, string> = {
  "claude-sonnet-4-6": "#8b5cf6",
  "claude-opus-4-7": "#6d28d9",
  "claude-haiku-4-5": "#a78bfa",
  "claude-haiku-4-5-20251001": "#a78bfa",
};

function modelColor(model: string): string {
  if (model.includes("opus")) return "#6d28d9";
  if (model.includes("haiku")) return "#a78bfa";
  if (model.includes("sonnet")) return "#8b5cf6";
  if (model.includes("gpt-4o")) return "#10b981";
  if (model.includes("gpt")) return "#34d399";
  return MODEL_COLORS[model] ?? "#94a3b8";
}

const STATUS_COLORS: Record<string, string> = {
  open: "#8b5cf6",
  resolved: "#10b981",
  escalated: "#f59e0b",
  closed: "#3f3f46",
  unknown: "#52525b",
};

const CHANNEL_COLORS: Record<string, string> = {
  web: "#8b5cf6",
  whatsapp: "#10b981",
  slack: "#f59e0b",
  teams: "#3b82f6",
  direct: "#06b6d4",
  email: "#f97316",
};

// ─── sub-components ──────────────────────────────────────────────────────────

function MetricChip({
  label, value, sub, icon, trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  trend?: { pct: number };
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-white/[0.07] bg-zinc-900/50 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.05] text-zinc-400">
          {icon}
        </div>
        {trend !== undefined && (
          <span
            className={cn(
              "flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
              trend.pct >= 0
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400"
            )}
          >
            {trend.pct >= 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            {Math.abs(trend.pct)}%
          </span>
        )}
      </div>
      <p className="mt-2.5 font-mono text-2xl font-bold text-zinc-100 leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-zinc-600">{label}</p>
      {sub && <p className="mt-0.5 text-[10px] text-zinc-700">{sub}</p>}
    </motion.div>
  );
}

function SectionCard({ title, children, className }: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-white/[0.07] bg-zinc-900/50 p-5", className)}>
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">{title}</h3>
      {children}
    </div>
  );
}

function ActivityChart({ data }: { data: FullDashboardStats["activityByDay"] }) {
  if (!data.length) return <div className="flex h-52 items-center justify-center text-xs text-zinc-700">No data</div>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
        <XAxis dataKey="date" tick={{ fill: AXIS_COLOR, fontSize: 10 }} tickLine={false} axisLine={false}
          tickFormatter={fmtDate} interval="preserveStartEnd" />
        <YAxis yAxisId="left" tick={{ fill: AXIS_COLOR, fontSize: 10 }} tickLine={false} axisLine={false}
          allowDecimals={false} />
        <YAxis yAxisId="right" orientation="right" tick={{ fill: "#06b6d4", fontSize: 10 }}
          tickLine={false} axisLine={false} tickFormatter={fmtTokens} />
        <Tooltip contentStyle={TOOLTIP_STYLE}
          labelFormatter={(v) => new Date(String(v) + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          formatter={(v, name) => [
            name === "tokens" ? fmtTokens(Number(v)) : String(v),
            name === "tokens" ? "Tokens" : "Conversations",
          ]}
        />
        <Bar yAxisId="left" dataKey="conversations" fill="url(#convGrad)" stroke="#8b5cf6"
          strokeWidth={1} radius={[3, 3, 0, 0]} maxBarSize={24} />
        <Line yAxisId="right" type="monotone" dataKey="tokens" stroke="#06b6d4"
          strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: "#06b6d4", strokeWidth: 0 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function AgentBars({ data }: { data: FullDashboardStats["agentUsage"] }) {
  if (!data.length) return <div className="flex h-52 items-center justify-center text-xs text-zinc-700">No data</div>;
  const chartData = data.map(a => ({ name: a.name.length > 12 ? a.name.slice(0, 11) + "…" : a.name, tokens: a.tokens, color: modelColor(a.model) }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
        <XAxis type="number" tick={{ fill: AXIS_COLOR, fontSize: 10 }} tickLine={false} axisLine={false}
          tickFormatter={fmtTokens} />
        <YAxis type="category" dataKey="name" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false}
          axisLine={false} width={80} />
        <Tooltip contentStyle={TOOLTIP_STYLE}
          formatter={(v: unknown) => [fmtTokens(Number(v)), "Tokens"]} />
        <Bar dataKey="tokens" radius={[0, 4, 4, 0]} maxBarSize={16}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.color} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DonutChart({ data, colors, valueKey = "count", nameKey = "name" }: {
  data: Record<string, unknown>[];
  colors: Record<string, string>;
  valueKey?: string;
  nameKey?: string;
}) {
  if (!data.length) return <div className="flex h-40 items-center justify-center text-xs text-zinc-700">No data</div>;
  const FALLBACK = "#52525b";
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie data={data} dataKey={valueKey} nameKey={nameKey} cx="50%" cy="50%"
          innerRadius={42} outerRadius={68} paddingAngle={3} strokeWidth={0}>
          {data.map((entry, i) => {
            const key = String(entry[nameKey]);
            return <Cell key={i} fill={colors[key] ?? FALLBACK} fillOpacity={0.85} />;
          })}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function Legend({ items, colors }: { items: { key: string; label: string; value: string | number }[]; colors: Record<string, string> }) {
  return (
    <div className="mt-1 space-y-1.5">
      {items.map(item => (
        <div key={item.key} className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: colors[item.key] ?? "#52525b" }} />
            <span className="truncate text-[11px] text-zinc-500">{item.label}</span>
          </div>
          <span className="font-mono text-[11px] text-zinc-400 shrink-0">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function AgentTable({ data }: { data: FullDashboardStats["agentUsage"] }) {
  if (!data.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-white/[0.05]">
            {["Agent", "Model", "Conversations", "Tokens", "Cost (USD)", "Tokens / Conv"].map(h => (
              <th key={h} className="pb-2.5 pr-6 text-[10px] font-semibold uppercase tracking-widest text-zinc-600 last:pr-0">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((a, i) => (
            <motion.tr
              key={a.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="border-b border-white/[0.03] last:border-0"
            >
              <td className="py-2.5 pr-6">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span className="text-sm font-medium text-zinc-200">{a.name}</span>
                </div>
              </td>
              <td className="py-2.5 pr-6">
                <span className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-500">
                  {a.model}
                </span>
              </td>
              <td className="py-2.5 pr-6 font-mono text-sm text-zinc-300">{a.conversations.toLocaleString()}</td>
              <td className="py-2.5 pr-6">
                <div className="flex items-center gap-2">
                  <div className="h-1 w-16 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (a.tokens / (data[0]?.tokens || 1)) * 100)}%`,
                        backgroundColor: modelColor(a.model),
                      }}
                    />
                  </div>
                  <span className="font-mono text-sm text-zinc-300">{fmtTokens(a.tokens)}</span>
                </div>
              </td>
              <td className="py-2.5 pr-6 font-mono text-sm text-amber-400">${a.costUsd.toFixed(2)}</td>
              <td className="py-2.5 font-mono text-sm text-zinc-500">{fmtTokens(a.tokensPerConv)}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── main export ────────────────────────────────────────────────────────────

interface DashboardClientProps {
  stats: FullDashboardStats;
  workspaceName: string;
  locale: string;
}

export function DashboardClient({ stats, workspaceName }: DashboardClientProps) {
  const momPct = stats.totalTokensLastMonth > 0
    ? Math.round(((stats.totalTokensMonth - stats.totalTokensLastMonth) / stats.totalTokensLastMonth) * 100)
    : 0;

  const costPerConv = stats.conversationsMonth > 0
    ? (stats.totalCostMonth / stats.conversationsMonth).toFixed(3)
    : "—";

  // Prepare donut data
  const costData = stats.agentUsage.map(a => ({ name: a.name, count: a.costUsd }));
  const costColors = Object.fromEntries(stats.agentUsage.map(a => [a.name, modelColor(a.model)]));

  const statusData = stats.statusDistribution.map(s => ({ name: s.status, count: s.count }));
  const channelData = stats.channelDistribution.map(c => ({ name: c.type, count: c.count }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
            Command Center
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            {workspaceName} · Real-time metrics
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">Live</span>
        </div>
      </div>

      {/* Operational KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Active Agents" value={stats.activeAgents} icon={<Bot size={16} />} color="primary" />
        <KpiCard label="Conversations Today" value={stats.conversationsToday} icon={<MessageSquare size={16} />} color="accent" />
        <KpiCard label="Total Employees" value={stats.totalEmployees} icon={<Users size={16} />} color="success" />
        <KpiCard label="Avg Response Time" value={fmtDuration(stats.avgDurationSeconds)} icon={<Clock size={16} />} color="warning" />
      </div>

      {/* Usage metric chips */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricChip
          label="Tokens / Month"
          value={fmtTokens(stats.totalTokensMonth)}
          sub="vs last month"
          icon={<Zap size={14} />}
          {...(stats.totalTokensLastMonth > 0 ? { trend: { pct: momPct } } : {})}
        />
        <MetricChip
          label="Est. Cost"
          value={`$${stats.totalCostMonth.toFixed(2)}`}
          sub={`$${costPerConv} / conv`}
          icon={<DollarSign size={14} />}
        />
        <MetricChip
          label="Conversations"
          value={stats.conversationsMonth.toLocaleString()}
          sub="this month"
          icon={<Activity size={14} />}
        />
        <MetricChip
          label="Avg Tokens / Conv"
          value={fmtTokens(stats.avgTokensPerConv)}
          sub={`${stats.activeTeams} active teams`}
          icon={<BarChart3 size={14} />}
        />
      </div>

      {/* Main charts */}
      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard title="Activity — Last 30 Days" className="lg:col-span-3">
          <div className="mb-2 flex items-center gap-4 text-[10px] text-zinc-600">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm bg-violet-500/60" />
              Conversations
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-cyan-400" />
              Tokens
            </span>
          </div>
          <ActivityChart data={stats.activityByDay} />
        </SectionCard>
        <SectionCard title="Token Usage by Agent" className="lg:col-span-2">
          <AgentBars data={stats.agentUsage} />
        </SectionCard>
      </div>

      {/* Secondary charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Cost Distribution">
          <DonutChart data={costData} colors={costColors} nameKey="name" />
          <Legend
            items={costData.slice(0, 4).map(d => ({ key: d.name, label: d.name, value: `$${d.count.toFixed(2)}` }))}
            colors={costColors}
          />
        </SectionCard>

        <SectionCard title="Conversations by Status">
          <DonutChart data={statusData} colors={STATUS_COLORS} nameKey="name" />
          <Legend
            items={statusData.map(d => ({ key: d.name, label: d.name, value: d.count }))}
            colors={STATUS_COLORS}
          />
        </SectionCard>

        <SectionCard title="Conversations by Channel">
          <DonutChart data={channelData} colors={CHANNEL_COLORS} nameKey="name" />
          <Legend
            items={channelData.map(d => ({ key: d.name, label: d.name, value: d.count }))}
            colors={CHANNEL_COLORS}
          />
        </SectionCard>
      </div>

      {/* Agent table */}
      <SectionCard title={`Agent Performance · ${stats.agentUsage.length} agents`}>
        <AgentTable data={stats.agentUsage} />
      </SectionCard>

      {/* Spacer */}
      <div className="h-2" />
    </div>
  );
}
