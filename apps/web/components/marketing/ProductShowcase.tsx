"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import {
  Brain,
  Workflow,
  Network,
  MessagesSquare,
  DollarSign,
  BookOpen,
  Users,
  Bot,
  MessageCircle,
  Send,
  Hash,
  type LucideIcon,
} from "lucide-react";

// ─── Shared Card primitives ───────────────────────────────────────────────────

function Card({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ delay, duration: 0.55, ease: [0.22, 0.61, 0.36, 1] }}
      className={`group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 transition-all duration-300 hover:border-zinc-700 hover:bg-zinc-900/60 ${className}`}
    >
      {children}
    </motion.div>
  );
}

function CardHeader({
  Icon,
  label,
  title,
  subtitle,
  accent = "text-violet-400",
}: {
  Icon: LucideIcon;
  label: string;
  title: string;
  subtitle: string;
  accent?: string;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center gap-2">
        <Icon size={13} className={accent} />
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          {label}
        </span>
      </div>
      <h3 className="font-display text-sm font-semibold text-zinc-100">{title}</h3>
      <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
    </div>
  );
}

// ─── 1. Brain Inspector ───────────────────────────────────────────────────────

const BRAIN_FACTS = [
  { text: "User prefers concise responses", strength: 92, source: "msg #1247" },
  {
    text: "Account tier: Enterprise · 50 seats",
    strength: 88,
    source: "msg #844",
  },
  {
    text: "Onboarded 2024-03 via Slack channel",
    strength: 71,
    source: "msg #312",
  },
  {
    text: "Previously contacted by Sales (Q3)",
    strength: 54,
    source: "msg #198",
  },
] as const;

function BrainMockup() {
  return (
    <div className="space-y-2">
      {BRAIN_FACTS.map((fact, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg bg-zinc-800/50 px-2.5 py-2">
          {/* Avatar circle */}
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[9px] font-bold text-violet-300">
            {i + 1}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] text-zinc-300">{fact.text}</p>
            <p className="mt-0.5 text-[9px] text-zinc-600">decay: -2%/d · {fact.source}</p>
            {/* Memory strength bar */}
            <div className="mt-1 flex items-center gap-1.5">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-700">
                <div
                  className="h-full rounded-full bg-violet-500"
                  style={{ width: `${fact.strength}%` }}
                />
              </div>
              <span className="shrink-0 text-[9px] text-zinc-500">{fact.strength}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 2. Flow Builder ─────────────────────────────────────────────────────────

function FlowMockup() {
  // Node positions for the SVG canvas (width=400, height=160)
  const nodes = [
    { id: "trigger", label: "Trigger", x: 170, y: 12, color: "#f59e0b", textColor: "#fef3c7" },
    {
      id: "classify",
      label: "Classify intent",
      x: 145,
      y: 62,
      color: "#8b5cf6",
      textColor: "#ede9fe",
    },
    {
      id: "search",
      label: "Search knowledge",
      x: 60,
      y: 112,
      color: "#06b6d4",
      textColor: "#cffafe",
    },
    { id: "api", label: "Call API", x: 240, y: 112, color: "#6366f1", textColor: "#e0e7ff" },
    { id: "reply", label: "Reply", x: 170, y: 156, color: "#10b981", textColor: "#d1fae5" },
  ] as const;

  // Bezier edges: [fromX, fromY, toX, toY]
  const edges: [number, number, number, number][] = [
    [200, 24, 200, 62], // trigger → classify
    [180, 76, 110, 112], // classify → search
    [220, 76, 280, 112], // classify → api
    [110, 126, 195, 156], // search → reply
    [280, 126, 210, 156], // api → reply
  ];

  return (
    <div className="relative overflow-hidden rounded-lg bg-zinc-900/60">
      {/* Faint grid */}
      <svg className="absolute inset-0 h-full w-full opacity-20" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M 16 0 L 0 0 0 16" fill="none" stroke="#52525b" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Flow SVG */}
      <svg
        viewBox="0 0 400 180"
        className="relative h-[140px] w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Edges */}
        {edges.map(([x1, y1, x2, y2], i) => {
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
              stroke="#3f3f46"
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          const w = n.label.length * 6.2 + 16;
          const h = 20;
          const rx = n.x - w / 2;
          const ry = n.y;
          return (
            <g key={n.id}>
              <rect
                x={rx}
                y={ry}
                width={w}
                height={h}
                rx={4}
                fill={`${n.color}22`}
                stroke={n.color}
                strokeWidth="1"
              />
              <text
                x={n.x}
                y={ry + 13}
                textAnchor="middle"
                fill={n.textColor}
                fontSize="9"
                fontFamily="ui-monospace, monospace"
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── 3. Org Chart ────────────────────────────────────────────────────────────

const AGENT_COLOR_MAP = {
  cyan: { bg: "bg-cyan-500/20", text: "text-cyan-300" },
  emerald: { bg: "bg-emerald-500/20", text: "text-emerald-300" },
} as const satisfies Record<string, { bg: string; text: string }>;

function agentColors(c: keyof typeof AGENT_COLOR_MAP) {
  return AGENT_COLOR_MAP[c];
}

const ORG_AGENTS = [
  { letter: "P", label: "Prospect", c: "cyan", left: "5%" },
  { letter: "C", label: "Closer", c: "cyan", left: "30%" },
  { letter: "T", label: "Triage", c: "emerald", left: "55%" },
  { letter: "E", label: "Escalate", c: "emerald", left: "80%" },
] as const;

function OrgMockup() {
  return (
    <div className="space-y-2">
      <div className="relative">
        <svg viewBox="0 0 240 110" className="h-[110px] w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="orgEdge" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#71717a" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          {/* Tier 1 → Tier 2 */}
          <path d="M 120 25 Q 120 35 80 50" stroke="url(#orgEdge)" strokeWidth="1.2" fill="none" />
          <path d="M 120 25 Q 120 35 160 50" stroke="url(#orgEdge)" strokeWidth="1.2" fill="none" />
          {/* Tier 2 → Tier 3 (Sales side) */}
          <path
            d="M 80 65 Q 80 80 40 95"
            stroke="url(#orgEdge)"
            strokeWidth="1"
            fill="none"
            opacity="0.7"
          />
          <path
            d="M 80 65 Q 80 80 100 95"
            stroke="url(#orgEdge)"
            strokeWidth="1"
            fill="none"
            opacity="0.7"
          />
          {/* Tier 2 → Tier 3 (Support side) */}
          <path
            d="M 160 65 Q 160 80 140 95"
            stroke="url(#orgEdge)"
            strokeWidth="1"
            fill="none"
            opacity="0.7"
          />
          <path
            d="M 160 65 Q 160 80 200 95"
            stroke="url(#orgEdge)"
            strokeWidth="1"
            fill="none"
            opacity="0.7"
          />
        </svg>

        {/* Orchestrator pill */}
        <div className="absolute left-1/2 top-0 -translate-x-1/2">
          <div className="flex items-center gap-1.5 rounded-md border border-violet-500/50 bg-gradient-to-br from-violet-500/25 to-indigo-500/20 px-2 py-1">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[9px] font-semibold text-violet-100">Orchestrator</span>
            <span className="rounded bg-zinc-900/40 px-1 font-mono text-[8px] text-violet-200">
              opus-4
            </span>
          </div>
        </div>

        {/* Team pills */}
        <div className="absolute left-[18%] top-[40%] -translate-y-1/2">
          <div className="flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5">
            <Users size={9} className="text-cyan-400" />
            <span className="text-[8px] font-medium text-cyan-200">Sales Team</span>
          </div>
        </div>
        <div className="absolute right-[18%] top-[40%] -translate-y-1/2">
          <div className="flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5">
            <Users size={9} className="text-emerald-400" />
            <span className="text-[8px] font-medium text-emerald-200">Support</span>
          </div>
        </div>

        {/* Agent pills */}
        {ORG_AGENTS.map((a) => (
          <div key={a.label} className="absolute bottom-0" style={{ left: a.left }}>
            <div className="flex items-center gap-1 rounded-md border border-zinc-700/60 bg-zinc-900/60 px-1.5 py-0.5">
              <div
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold ${agentColors(a.c).bg} ${agentColors(a.c).text}`}
              >
                {a.letter}
              </div>
              <span className="text-[8px] font-medium text-zinc-400">{a.label}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-zinc-800/50 pt-1.5 text-[9px] text-zinc-600">
        <span>12 agents</span>
        <span>3 tiers</span>
        <span>247 convs</span>
      </div>
    </div>
  );
}

// ─── 4. Conversations ────────────────────────────────────────────────────────

const CONVS_DATA = [
  {
    name: "WhatsApp",
    Icon: MessageCircle,
    bg: "bg-emerald-500",
    time: "2m",
    user: { letter: "M", msg: "Hola, busco info del plan Pro" },
    agent: { msg: "Pro: $49/mes/seat. ¿Demo?" },
  },
  {
    name: "Telegram",
    Icon: Send,
    bg: "bg-sky-500",
    time: "5m",
    user: { letter: "L", msg: "¿Conecta con HubSpot?" },
    agent: { msg: "Sí — conector nativo." },
  },
  {
    name: "Slack",
    Icon: Hash,
    bg: "bg-fuchsia-500",
    time: "now",
    user: { letter: "@", msg: "Resumir ticket #4521" },
    agent: { msg: "Latency en SSE. Asigné a infra." },
  },
] as const;

function ConvsMockup() {
  return (
    <div className="space-y-1.5">
      {CONVS_DATA.map(({ name, Icon, bg, time, user, agent }) => (
        <div key={name} className="rounded-lg border border-zinc-800/50 bg-zinc-900/40 p-2">
          {/* Channel header */}
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className={`flex h-4 w-4 items-center justify-center rounded-full ${bg}`}>
                <Icon size={9} className="text-white" />
              </div>
              <span className="text-[10px] font-medium text-zinc-300">{name}</span>
            </div>
            <span className="font-mono text-[8px] text-zinc-600">{time}</span>
          </div>
          {/* Messages */}
          <div className="space-y-1">
            {/* User bubble */}
            <div className="flex items-start gap-1.5">
              <div className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[7px] font-bold text-zinc-300">
                {user.letter}
              </div>
              <p className="truncate rounded-md bg-zinc-800/60 px-1.5 py-0.5 text-[9px] text-zinc-300">
                {user.msg}
              </p>
            </div>
            {/* Agent bubble */}
            <div className="flex items-start justify-end gap-1.5">
              <p className="truncate rounded-md border border-violet-500/30 bg-gradient-to-br from-violet-500/20 to-indigo-500/15 px-1.5 py-0.5 text-[9px] text-zinc-200">
                {agent.msg}
              </p>
              <div className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-violet-500">
                <Bot size={8} className="text-white" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 5. Cost Dashboard ───────────────────────────────────────────────────────

// 14 semi-realistic spend data points (daily, $)
const SPARKLINE_POINTS = [0.8, 1.2, 0.6, 1.5, 2.1, 1.8, 0.9, 1.4, 1.7, 2.3, 1.1, 1.9, 2.0, 1.6];

function CostMockup() {
  const max = Math.max(...SPARKLINE_POINTS);
  const w = 200;
  const h = 36;
  const pts = SPARKLINE_POINTS.map(
    (v, i) => `${(i / (SPARKLINE_POINTS.length - 1)) * w},${h - (v / max) * h * 0.9 - 2}`
  ).join(" ");

  const PROVIDERS = [
    { name: "Anthropic", amount: "$7.20", color: "bg-violet-500" },
    { name: "OpenAI", amount: "$4.10", color: "bg-cyan-500" },
    { name: "Google", amount: "$1.10", color: "bg-amber-500" },
  ] as const;

  return (
    <div className="space-y-3">
      {/* Big number */}
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold text-white">$12.40</span>
          <span className="text-[10px] text-zinc-500">of $50 budget</span>
        </div>
        {/* Progress bar */}
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-500"
            style={{ width: "24.8%" }}
          />
        </div>
        <p className="mt-0.5 text-[9px] text-zinc-600">24.8% used this billing period</p>
      </div>

      {/* Sparkline */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-9 w-full"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline
          points={pts}
          fill="none"
          stroke="#8b5cf6"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polygon points={`0,${h} ${pts} ${w},${h}`} fill="url(#sparkFill)" />
      </svg>

      {/* Provider breakdown */}
      <div className="space-y-1">
        {PROVIDERS.map((p) => (
          <div key={p.name} className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${p.color}`} />
            <span className="flex-1 text-[10px] text-zinc-400">{p.name}</span>
            <span className="text-[10px] font-medium text-zinc-300">{p.amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 6. Knowledge ────────────────────────────────────────────────────────────

const DOCS = [
  {
    icon: "📄",
    name: "product-brief.pdf",
    color: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  },
  { icon: "📝", name: "README.md", color: "border-zinc-600 bg-zinc-800 text-zinc-300" },
  { icon: "🔗", name: "docs.orchester.ai", color: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  {
    icon: "📊",
    name: "contacts.csv",
    color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  {
    icon: "📄",
    name: "terms-of-service.pdf",
    color: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  },
  { icon: "📝", name: "CHANGELOG.md", color: "border-zinc-600 bg-zinc-800 text-zinc-300" },
] as const;

function KnowledgeMockup() {
  return (
    <div className="space-y-3">
      {/* Search bar mock */}
      <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5">
        <span className="text-xs text-zinc-500">🔍</span>
        <span className="text-xs text-zinc-500">Search 234 documents…</span>
      </div>

      {/* Document chips */}
      <div className="flex flex-wrap gap-2">
        {DOCS.map((doc, i) => (
          <div
            key={i}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 ${doc.color}`}
          >
            <span className="text-[11px]">{doc.icon}</span>
            <span className="text-[10px] font-medium">{doc.name}</span>
            {/* Indexed dot */}
            <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" title="Indexed" />
          </div>
        ))}
      </div>

      {/* Stats footer */}
      <div className="flex items-center justify-end gap-1">
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">
          1,247 chunks
        </span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">
          768d embeddings
        </span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">pgvector</span>
      </div>
    </div>
  );
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export function ProductShowcase() {
  const t = useTranslations("marketing.productShowcase");

  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center"
        >
          <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {t("title1")}{" "}
            <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
              {t("title2")}
            </span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-base text-zinc-500">{t("subtitle")}</p>
        </motion.div>

        {/* Bento grid */}
        <div className="grid auto-rows-[260px] grid-cols-1 gap-4 md:grid-cols-3">
          {/* Brain Inspector — 1 col */}
          <Card delay={0}>
            <CardHeader
              Icon={Brain}
              label={t("brain.label")}
              title={t("brain.title")}
              subtitle={t("brain.subtitle")}
              accent="text-violet-400"
            />
            <BrainMockup />
          </Card>

          {/* Flow Builder — 2 cols */}
          <Card delay={0.08} className="md:col-span-2">
            <CardHeader
              Icon={Workflow}
              label={t("flow.label")}
              title={t("flow.title")}
              subtitle={t("flow.subtitle")}
              accent="text-cyan-400"
            />
            <FlowMockup />
          </Card>

          {/* Org Chart — 1 col */}
          <Card delay={0.16}>
            <CardHeader
              Icon={Network}
              label={t("org.label")}
              title={t("org.title")}
              subtitle={t("org.subtitle")}
              accent="text-indigo-400"
            />
            <OrgMockup />
          </Card>

          {/* Conversations — 1 col */}
          <Card delay={0.24}>
            <CardHeader
              Icon={MessagesSquare}
              label={t("convs.label")}
              title={t("convs.title")}
              subtitle={t("convs.subtitle")}
              accent="text-emerald-400"
            />
            <ConvsMockup />
          </Card>

          {/* Cost Dashboard — 1 col */}
          <Card delay={0.32}>
            <CardHeader
              Icon={DollarSign}
              label={t("cost.label")}
              title={t("cost.title")}
              subtitle={t("cost.subtitle")}
              accent="text-amber-400"
            />
            <CostMockup />
          </Card>

          {/* Knowledge — full width */}
          <Card delay={0.4} className="md:col-span-3">
            <CardHeader
              Icon={BookOpen}
              label={t("knowledge.label")}
              title={t("knowledge.title")}
              subtitle={t("knowledge.subtitle")}
              accent="text-rose-400"
            />
            <KnowledgeMockup />
          </Card>
        </div>
      </div>
    </section>
  );
}
