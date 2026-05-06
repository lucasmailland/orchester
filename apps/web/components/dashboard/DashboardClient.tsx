"use client";

import { motion } from "framer-motion";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, AreaChart, Area,
} from "recharts";
import {
  Bot, MessageSquare, Users, Clock, Zap, DollarSign, BarChart3,
  Activity, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  Globe, Send, MessageCircle, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FullDashboardStats } from "@/lib/db-queries";

// ─── constants ───────────────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  backgroundColor: "#09090b",
  border: "1px solid rgba(139,92,246,0.25)",
  borderRadius: "10px",
  fontSize: "11px",
  fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
  color: "#e4e4e7",
  boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
  padding: "8px 12px",
};

const GRID = "rgba(255,255,255,0.035)";
const AXIS = "#3f3f46";

const MODEL_COLOR: Record<string, string> = {
  "claude-sonnet-4-6": "#8b5cf6",
  "claude-opus-4-7": "#6d28d9",
  "claude-haiku-4-5": "#a78bfa",
  "claude-haiku-4-5-20251001": "#a78bfa",
};

function mColor(model: string) {
  if (model.includes("opus")) return "#6d28d9";
  if (model.includes("haiku")) return "#a78bfa";
  if (model.includes("sonnet")) return "#8b5cf6";
  return MODEL_COLOR[model] ?? "#94a3b8";
}

const STATUS_COLOR: Record<string, string> = {
  open: "#8b5cf6", escalated: "#f59e0b",
  closed: "#22c55e", resolved: "#10b981", unknown: "#52525b",
};

const CH_COLOR: Record<string, string> = {
  web: "#8b5cf6", whatsapp: "#22c55e", telegram: "#38bdf8",
  slack: "#f59e0b", direct: "#06b6d4", email: "#f97316",
};

const CH_ICON: Record<string, React.ReactNode> = {
  web: <Globe size={11} />, whatsapp: <MessageCircle size={11} />,
  telegram: <Send size={11} />, direct: <MessageSquare size={11} />,
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtT(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDate(s: string) {
  const d = new Date(s + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDur(s: number) {
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

function fmtTime(d: Date) {
  const diff = Date.now() - new Date(d).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function pctChange(now: number, prev: number) {
  if (prev === 0) return null;
  return Math.round(((now - prev) / prev) * 100);
}

// ─── atomic components ───────────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-white/[0.07] bg-zinc-900/60 backdrop-blur-sm", className)}>
      {children}
    </div>
  );
}

function CardHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 pt-5 pb-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">{title}</p>
        {sub && <p className="mt-0.5 text-[10px] text-zinc-700">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function Delta({ now, prev }: { now: number; prev: number }) {
  const pct = pctChange(now, prev);
  if (pct === null) return null;
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
      pct >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
    )}>
      {pct >= 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
      {Math.abs(pct)}%
    </span>
  );
}

// ─── KPI card — primary row ───────────────────────────────────────────────────

function KPI({
  label, value, sub, icon, accent, trend,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent: string;          // tailwind color key
  trend?: { now: number; prev: number };
}) {
  const ACCENT: Record<string, { bg: string; text: string; ring: string }> = {
    violet: { bg: "bg-violet-500/10", text: "text-violet-400", ring: "ring-violet-500/20" },
    cyan:   { bg: "bg-cyan-500/10",   text: "text-cyan-400",   ring: "ring-cyan-500/20" },
    emerald:{ bg: "bg-emerald-500/10",text: "text-emerald-400",ring: "ring-emerald-500/20" },
    amber:  { bg: "bg-amber-500/10",  text: "text-amber-400",  ring: "ring-amber-500/20" },
    red:    { bg: "bg-red-500/10",    text: "text-red-400",    ring: "ring-red-500/20" },
    blue:   { bg: "bg-blue-500/10",   text: "text-blue-400",   ring: "ring-blue-500/20" },
  };
  const a = ACCENT[accent] ?? ACCENT.violet!;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/[0.07] bg-zinc-900/60 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl ring-1", a.bg, a.text, a.ring)}>
          {icon}
        </div>
        {trend && <Delta now={trend.now} prev={trend.prev} />}
      </div>
      <p className="mt-3 font-mono text-[1.6rem] font-bold leading-none tracking-tight text-zinc-50">
        {value}
      </p>
      <p className="mt-1.5 text-[11px] font-medium text-zinc-500">{label}</p>
      {sub && <p className="mt-0.5 text-[10px] text-zinc-700">{sub}</p>}
    </motion.div>
  );
}

// ─── Activity chart (convs + tokens dual axis) ────────────────────────────────

function ActivityChart({ data }: { data: FullDashboardStats["activityByDay"] }) {
  if (!data.length) return <Empty h={220} />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="convG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.03} />
          </linearGradient>
          <linearGradient id="tokG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
        <XAxis dataKey="date" tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false}
          tickFormatter={fmtDate} interval="preserveStartEnd" />
        <YAxis yAxisId="l" tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis yAxisId="r" orientation="right" tick={{ fill: "#06b6d4", fontSize: 10 }}
          tickLine={false} axisLine={false} tickFormatter={fmtT} />
        <Tooltip contentStyle={TOOLTIP_STYLE}
          labelFormatter={v => new Date(String(v) + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          formatter={(v, name) => [name === "tokens" ? fmtT(Number(v)) : String(v), name === "tokens" ? "Tokens" : "Conversaciones"]}
        />
        <Bar yAxisId="l" dataKey="conversations" fill="url(#convG)" stroke="#8b5cf6" strokeWidth={1}
          radius={[3, 3, 0, 0]} maxBarSize={20} />
        <Line yAxisId="r" type="monotone" dataKey="tokens" stroke="#06b6d4" strokeWidth={1.5}
          dot={false} activeDot={{ r: 3, fill: "#06b6d4", strokeWidth: 0 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── Hourly distribution bar chart ───────────────────────────────────────────

function HourlyChart({ data }: { data: FullDashboardStats["hourlyDist"] }) {
  const peak = Math.max(...data.map(d => d.count), 1);
  const peakHour = data.reduce((a, b) => b.count > a.count ? b : a, data[0]!);
  return (
    <div>
      <p className="mb-1 text-[10px] text-zinc-700">
        Pico: <span className="text-zinc-400">{peakHour.hour}:00 h</span>
      </p>
      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={data} margin={{ top: 0, right: 0, left: -32, bottom: 0 }} barCategoryGap={2}>
          <XAxis dataKey="hour" tick={{ fill: AXIS, fontSize: 9 }} tickLine={false} axisLine={false}
            tickFormatter={h => h % 6 === 0 ? `${h}h` : ""} />
          <Tooltip contentStyle={TOOLTIP_STYLE}
            formatter={(v) => [String(v), "Conversaciones"]}
            labelFormatter={h => `${h}:00 – ${Number(h) + 1}:00`}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.count === peak ? "#8b5cf6" : "#27272a"} fillOpacity={d.count === peak ? 1 : 0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Mini donut chart ─────────────────────────────────────────────────────────

function MiniDonut({ data, colors, center }: {
  data: { name: string; count: number }[];
  colors: Record<string, string>;
  center?: string;
}) {
  if (!data.length) return <Empty h={150} />;
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={150}>
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="name" cx="50%" cy="50%"
            innerRadius={46} outerRadius={64} paddingAngle={3} strokeWidth={0}>
            {data.map((entry, i) => (
              <Cell key={i} fill={colors[entry.name] ?? "#3f3f46"} fillOpacity={0.9} />
            ))}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} />
        </PieChart>
      </ResponsiveContainer>
      {center && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-sm font-bold text-zinc-300">{center}</span>
        </div>
      )}
    </div>
  );
}

// ─── Legend list ──────────────────────────────────────────────────────────────

function LegendList({ items, colors }: {
  items: { key: string; label: string; value: string | number; pct?: number }[];
  colors: Record<string, string>;
}) {
  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.key} className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: colors[item.key] ?? "#52525b" }} />
          <div className="flex flex-1 items-center justify-between min-w-0 gap-2">
            <span className="truncate text-[11px] text-zinc-500 capitalize">{item.label}</span>
            <div className="flex shrink-0 items-center gap-2">
              {item.pct !== undefined && (
                <div className="h-1 w-12 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full" style={{ width: `${item.pct}%`, backgroundColor: colors[item.key] ?? "#52525b" }} />
                </div>
              )}
              <span className="font-mono text-[11px] text-zinc-400">{item.value}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tiny area sparkline ──────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const pts = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width={80} height={28}>
      <AreaChart data={pts} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
          fill={`url(#spark-${color})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Empty({ h }: { h: number }) {
  return (
    <div className={`flex items-center justify-center text-[10px] text-zinc-700`} style={{ height: h }}>
      Sin datos
    </div>
  );
}

// ─── Agent performance table ──────────────────────────────────────────────────

function AgentTable({ data }: { data: FullDashboardStats["agentUsage"] }) {
  if (!data.length) return <Empty h={100} />;
  const maxTokens = data[0]?.tokens ?? 1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr>
            {["Agente", "Modelo", "Estado", "Conversaciones", "Tokens consumidos", "Costo USD", "Tok / Conv"].map(h => (
              <th key={h} className="pb-3 pr-4 text-left text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-600 first:pl-0 last:pr-0">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((a, i) => {
            const color = mColor(a.model);
            const STATUS_BADGE: Record<string, string> = {
              active: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
              inactive: "text-zinc-500 bg-zinc-800/50 border-zinc-700/50",
              draft: "text-amber-400 bg-amber-500/10 border-amber-500/20",
            };
            return (
              <motion.tr
                key={a.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.035 }}
                className="group border-b border-white/[0.04] last:border-0"
              >
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2.5">
                    <div className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-sm font-semibold text-zinc-100">{a.name}</span>
                  </div>
                </td>
                <td className="py-3 pr-4">
                  <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[9px]" style={{ color }}>
                    {a.model.replace("claude-", "").replace("-20251001", "")}
                  </span>
                </td>
                <td className="py-3 pr-4">
                  <span className={cn("rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide", STATUS_BADGE[a.status] ?? STATUS_BADGE.inactive)}>
                    {a.status}
                  </span>
                </td>
                <td className="py-3 pr-4 font-mono text-sm text-zinc-300">{a.conversations.toLocaleString()}</td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-3">
                    <div className="h-[3px] w-24 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full transition-all" style={{ width: `${(a.tokens / maxTokens) * 100}%`, backgroundColor: color }} />
                    </div>
                    <span className="font-mono text-sm text-zinc-300">{fmtT(a.tokens)}</span>
                  </div>
                </td>
                <td className="py-3 pr-4 font-mono text-sm font-semibold text-amber-400">${a.costUsd.toFixed(2)}</td>
                <td className="py-3 font-mono text-sm text-zinc-500">{fmtT(a.tokensPerConv)}</td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Recent activity feed ─────────────────────────────────────────────────────

function ActivityFeed({ data }: { data: FullDashboardStats["recentConversations"] }) {
  const STATUS_PILL: Record<string, string> = {
    open: "text-violet-400 bg-violet-500/10",
    escalated: "text-amber-400 bg-amber-500/10",
    closed: "text-emerald-400 bg-emerald-500/10",
    resolved: "text-emerald-400 bg-emerald-500/10",
  };
  return (
    <div className="space-y-1">
      {data.slice(0, 6).map((c) => (
        <div key={c.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.03] transition-colors">
          <div className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            c.status === "open" ? "bg-violet-400" :
            c.status === "escalated" ? "bg-amber-400" : "bg-emerald-400"
          )} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate text-xs font-medium text-zinc-300">{c.employeeName ?? "Anon"}</span>
              <ArrowRight size={10} className="shrink-0 text-zinc-700" />
              <span className="truncate text-xs text-zinc-500">{c.agentName ?? "—"}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {c.channelType && (
                <span className="flex items-center gap-0.5 text-[9px] text-zinc-700 capitalize">
                  {CH_ICON[c.channelType]} {c.channelType}
                </span>
              )}
              <span className="text-[9px] text-zinc-700">·</span>
              <span className="text-[9px] text-zinc-700">{c.messageCount} msgs</span>
              {c.durationSeconds && (
                <>
                  <span className="text-[9px] text-zinc-700">·</span>
                  <span className="text-[9px] text-zinc-700">{fmtDur(c.durationSeconds)}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-semibold capitalize", STATUS_PILL[c.status] ?? "text-zinc-500 bg-zinc-800")}>
              {c.status}
            </span>
            <span className="font-mono text-[9px] text-zinc-700">{fmtTime(c.startedAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

interface Props { stats: FullDashboardStats; workspaceName: string; locale: string }

/** Formatea un porcentaje de cambio con signo. Devuelve null si el delta es nulo. */
function fmtDelta(delta: number | null | undefined): string | null {
  if (delta == null || !Number.isFinite(delta)) return null;
  const rounded = Math.round(delta);
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

export function DashboardClient({ stats, workspaceName, locale }: Props) {
  const now = new Date();
  const totalConvs30d = stats.activityByDay.reduce((s, d) => s + d.conversations, 0);
  const totalTokens30d = stats.activityByDay.reduce((s, d) => s + d.tokens, 0);
  const escalationRate = stats.conversationsMonth > 0
    ? ((stats.escalatedCount / stats.conversationsMonth) * 100).toFixed(1)
    : "0.0";
  const statusTotal = stats.statusDistribution.reduce((s, d) => s + d.count, 0);
  const resolutionRate = statusTotal > 0
    ? Math.round(((stats.statusDistribution.find(d => d.status === "closed")?.count ?? 0) / statusTotal) * 100)
    : 0;
  const costData = stats.agentUsage.map(a => ({ name: a.name, count: a.costUsd }));
  const costColors = Object.fromEntries(stats.agentUsage.map(a => [a.name, mColor(a.model)]));
  const sparkData = stats.activityByDay.slice(-14).map(d => d.conversations);

  return (
    <div className="space-y-5 pb-8">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">Command Center</h1>
          <p className="mt-0.5 text-sm text-zinc-600">
            {workspaceName} &nbsp;·&nbsp;
            {now.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden text-right sm:block">
            <p className="text-[10px] text-zinc-700">Últimos 30 días</p>
            <p className="font-mono text-xs font-bold text-zinc-400">{totalConvs30d.toLocaleString()} convs · {fmtT(totalTokens30d)} tokens</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Live</span>
          </div>
        </div>
      </div>

      {/* ── Row 1: 6 KPIs ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KPI label="Agentes activos" value={stats.activeAgents}
          sub={`de ${stats.totalAgents} totales`}
          icon={<Bot size={16} />} accent="violet" />
        <KPI label="Conversaciones hoy" value={stats.conversationsToday}
          sub={stats.conversationsToday === 0 && stats.conversationsYesterday === 0 ? "sin actividad reciente" : "vs ayer"}
          icon={<MessageSquare size={16} />} accent="cyan"
          trend={{ now: stats.conversationsToday, prev: stats.conversationsYesterday }} />
        <KPI label="Abiertas ahora" value={stats.openConversations}
          sub="en espera de respuesta"
          icon={<Activity size={16} />} accent="blue" />
        <KPI label="Empleados" value={stats.totalEmployees}
          sub="usuarios activos"
          icon={<Users size={16} />} accent="emerald" />
        <KPI label="Tasa escalación" value={`${escalationRate}%`}
          sub="este mes"
          icon={<AlertTriangle size={16} />} accent="amber" />
        <KPI label="Resolución" value={`${resolutionRate}%`}
          sub="conversaciones cerradas"
          icon={<CheckCircle2 size={16} />} accent="emerald" />
      </div>

      {/* ── Row 2: 4 usage metrics ── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          (() => {
            const delta = stats.totalTokensLastMonth > 0
              ? pctChange(stats.totalTokensMonth, stats.totalTokensLastMonth)
              : null;
            const formatted = fmtDelta(delta);
            return {
              icon: <Zap size={13} className="text-violet-400" />,
              label: "Tokens este mes",
              value: fmtT(stats.totalTokensMonth),
              sub: formatted ? `${formatted} vs mes ant.` : "primer mes",
              sparkColor: "#8b5cf6",
              delta,
            };
          })(),
          {
            icon: <DollarSign size={13} className="text-amber-400" />,
            label: "Costo estimado",
            value: `$${stats.totalCostMonth.toFixed(2)}`,
            sub: `$${stats.conversationsMonth > 0 ? (stats.totalCostMonth / stats.conversationsMonth).toFixed(3) : "—"} / conv`,
            sparkColor: "#f59e0b",
            delta: stats.totalCostLastMonth > 0 ? pctChange(stats.totalCostMonth, stats.totalCostLastMonth) : null,
          },
          {
            icon: <BarChart3 size={13} className="text-cyan-400" />,
            label: "Conversaciones / mes",
            value: stats.conversationsMonth.toLocaleString(),
            sub: stats.conversationsLastMonth > 0
              ? `${stats.conversationsLastMonth} el mes pasado`
              : "primer mes",
            sparkColor: "#06b6d4",
            delta: stats.conversationsLastMonth > 0 ? pctChange(stats.conversationsMonth, stats.conversationsLastMonth) : null,
          },
          {
            icon: <Clock size={13} className="text-blue-400" />,
            label: "Dur. media",
            value: fmtDur(stats.avgDurationSeconds),
            sub: `${fmtT(stats.avgTokensPerConv)} tokens / conv`,
            sparkColor: "#3b82f6",
            delta: null,
          },
        ].map(m => (
          <Card key={m.label} className="flex items-center gap-4 p-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                {m.icon}
                <span className="text-[10px] text-zinc-600">{m.label}</span>
              </div>
              <p className="font-mono text-xl font-bold text-zinc-50">{m.value}</p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-[10px] text-zinc-700">{m.sub}</span>
                {(() => {
                  const txt = fmtDelta(m.delta);
                  if (!txt || m.delta == null) return null;
                  return (
                    <span className={cn(
                      "text-[9px] font-bold",
                      m.delta >= 0 ? "text-emerald-500" : "text-red-500"
                    )}>
                      {txt}
                    </span>
                  );
                })()}
              </div>
            </div>
            <Sparkline data={sparkData} color={m.sparkColor} />
          </Card>
        ))}
      </div>

      {/* ── Row 3: Activity chart + Cost donut ── */}
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Actividad — últimos 30 días"
            action={
              <div className="flex items-center gap-4 text-[10px] text-zinc-600">
                <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-violet-500/60" />Conversaciones</span>
                <span className="flex items-center gap-1.5"><span className="h-px w-4 bg-cyan-400" />Tokens</span>
              </div>
            }
          />
          <div className="px-2 pb-4">
            <ActivityChart data={stats.activityByDay} />
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Costo por agente" sub="mes actual" />
          <div className="px-5 pb-5">
            <MiniDonut
              data={costData}
              colors={costColors}
              center={`$${stats.totalCostMonth.toFixed(2)}`}
            />
            <div className="mt-3">
              <LegendList
                items={costData.slice(0, 5).map(d => ({
                  key: d.name,
                  label: d.name,
                  value: `$${d.count.toFixed(2)}`,
                  pct: stats.totalCostMonth > 0 ? Math.round((d.count / stats.totalCostMonth) * 100) : 0,
                }))}
                colors={costColors}
              />
            </div>
          </div>
        </Card>
      </div>

      {/* ── Row 4: Agent performance table ── */}
      <Card>
        <CardHeader
          title={`Rendimiento de agentes · ${stats.agentUsage.length} agentes`}
          sub="mes actual · ordenado por consumo de tokens"
        />
        <div className="px-5 pb-5">
          <AgentTable data={stats.agentUsage} />
        </div>
      </Card>

      {/* ── Row A: Equipos + Pico — both compact, naturally similar height ── */}
      <div className="grid gap-4 lg:grid-cols-2 items-start">

        {/* Team stats */}
        <Card>
          <CardHeader title="Equipos" sub="últimos 30 días" />
          <div className="px-5 pb-5 space-y-3">
            {stats.teamStats.length === 0 && <Empty h={80} />}
            {stats.teamStats.map((t, i) => {
              const maxConvs = stats.teamStats[0]?.conversations ?? 1;
              return (
                <div key={t.teamId} className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-zinc-700 w-3 shrink-0">{i + 1}</span>
                  <div className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: t.teamColor ?? "#52525b" }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-zinc-200">{t.teamName}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-[2px] flex-1 overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-full rounded-full" style={{ width: `${(t.conversations / maxConvs) * 100}%`, backgroundColor: t.teamColor ?? "#8b5cf6", opacity: 0.7 }} />
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-600">{t.conversations} convs</span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-zinc-600">{fmtT(t.tokens)} tok</p>
                  </div>
                  <span className="shrink-0 font-mono text-xs font-semibold text-amber-400">${t.costUsd.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Peak hours */}
        <Card>
          <CardHeader title="Pico de actividad" sub="distribución por hora del día" />
          <div className="px-5 pb-5">
            <HourlyChart data={stats.hourlyDist} />
            <div className="mt-3 grid grid-cols-3 gap-2">
              {["Mañana (6-12)", "Tarde (12-18)", "Noche (18-24)"].map((label, i) => {
                const start = [6, 12, 18][i]!;
                const end = [12, 18, 24][i]!;
                const total = stats.hourlyDist
                  .filter(d => d.hour >= start && d.hour < end)
                  .reduce((s, d) => s + d.count, 0);
                return (
                  <div key={label} className="rounded-lg bg-zinc-800/40 p-2 text-center">
                    <p className="font-mono text-sm font-bold text-zinc-200">{total}</p>
                    <p className="text-[9px] text-zinc-600">{label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      </div>

      {/* ── Row B: Estado + Canal — both donuts, nearly identical height ── */}
      <div className="grid gap-4 lg:grid-cols-2 items-start">

        {/* Status */}
        <Card>
          <CardHeader title="Estado de conversaciones" sub="últimos 30 días" />
          <div className="px-5 pb-5">
            {stats.statusDistribution.length > 0 ? (
              <>
                <MiniDonut
                  data={stats.statusDistribution.map(d => ({ name: d.status, count: d.count }))}
                  colors={STATUS_COLOR}
                  center={`${statusTotal}`}
                />
                <div className="mt-3">
                  <LegendList
                    items={stats.statusDistribution.map(d => ({
                      key: d.status,
                      label: d.status,
                      value: d.count,
                      pct: statusTotal > 0 ? Math.round((d.count / statusTotal) * 100) : 0,
                    }))}
                    colors={STATUS_COLOR}
                  />
                </div>
              </>
            ) : <Empty h={120} />}
          </div>
        </Card>

        {/* Channel */}
        <Card>
          <CardHeader title="Canal de entrada" sub="últimos 30 días" />
          <div className="px-5 pb-5">
            {stats.channelDistribution.length > 0 ? (
              <>
                <MiniDonut
                  data={stats.channelDistribution.map(d => ({ name: d.type, count: d.count }))}
                  colors={CH_COLOR}
                />
                <div className="mt-3">
                  <LegendList
                    items={stats.channelDistribution.map(d => {
                      const tot = stats.channelDistribution.reduce((s, r) => s + r.count, 0);
                      return {
                        key: d.type,
                        label: d.type,
                        value: d.count,
                        pct: tot > 0 ? Math.round((d.count / tot) * 100) : 0,
                      };
                    })}
                    colors={CH_COLOR}
                  />
                </div>
              </>
            ) : <Empty h={120} />}
          </div>
        </Card>
      </div>

      {/* ── Row C: Empleados + Actividad — both list-heavy, nearly identical height ── */}
      <div className="grid gap-4 lg:grid-cols-2 items-start">

        {/* Top employees */}
        <Card>
          <CardHeader title="Empleados más activos" sub="últimos 30 días" />
          <div className="px-5 pb-5 space-y-2">
            {stats.topEmployees.length === 0 && <Empty h={80} />}
            {stats.topEmployees.map((e, i) => {
              const max = stats.topEmployees[0]?.conversations ?? 1;
              return (
                <div key={e.id} className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-zinc-700 w-3 shrink-0">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-zinc-200">{e.name}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <div className="h-[2px] flex-1 overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-full rounded-full bg-violet-500/60" style={{ width: `${(e.conversations / max) * 100}%` }} />
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-500">{e.conversations}</span>
                    </div>
                  </div>
                  {e.area && (
                    <span className="shrink-0 rounded bg-zinc-800/60 px-1.5 py-0.5 text-[9px] text-zinc-600">{e.area}</span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader title="Actividad reciente" sub="últimas conversaciones" />
          <div className="pb-1">
            {stats.recentConversations.length === 0
              ? <Empty h={100} />
              : <ActivityFeed data={stats.recentConversations} />
            }
          </div>
          <div className="border-t border-white/[0.04] px-5 py-2.5">
            <a href={`/${locale}/conversations`} className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
              <span>Ver todas las conversaciones</span>
              <ArrowRight size={10} />
            </a>
          </div>
        </Card>

      </div>

    </div>
  );
}
