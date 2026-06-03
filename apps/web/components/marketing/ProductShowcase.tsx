"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Brain, Workflow, Network, MessagesSquare, DollarSign, BookOpen } from "lucide-react";

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
  Icon: React.ElementType;
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
          const my = (y1 + y2) / 2;
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

const ORG_NODES = {
  root: { label: "Orchestrator", color: "border-blue-500/50 text-blue-300 bg-blue-500/10" },
  leads: [
    { label: "Sales Team", color: "border-violet-500/40 text-violet-300 bg-violet-500/10" },
    { label: "Support Team", color: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10" },
  ],
  agents: [
    { label: "Prospector", parent: 0, color: "text-zinc-400 border-zinc-700 bg-zinc-800/60" },
    { label: "Closer", parent: 0, color: "text-zinc-400 border-zinc-700 bg-zinc-800/60" },
    { label: "Triager", parent: 1, color: "text-zinc-400 border-zinc-700 bg-zinc-800/60" },
    { label: "Escalator", parent: 1, color: "text-zinc-400 border-zinc-700 bg-zinc-800/60" },
  ],
} as const;

function AgentChip({ label, color }: { label: string; color: string }) {
  return (
    <div className={`rounded-lg border px-2.5 py-1 text-center text-[10px] font-medium ${color}`}>
      {label}
    </div>
  );
}

function OrgMockup() {
  return (
    <div className="flex flex-col items-center gap-2 pt-1">
      {/* Root */}
      <AgentChip label={ORG_NODES.root.label} color={ORG_NODES.root.color} />

      {/* Connector line */}
      <div className="h-3 w-px bg-zinc-700" />

      {/* Lead row */}
      <div className="flex w-full items-center justify-center gap-3">
        {ORG_NODES.leads.map((lead) => (
          <AgentChip key={lead.label} label={lead.label} color={lead.color} />
        ))}
      </div>

      {/* Connector lines */}
      <div className="flex w-full justify-around px-6">
        {ORG_NODES.leads.map((lead) => (
          <div key={lead.label} className="h-3 w-px bg-zinc-700" />
        ))}
      </div>

      {/* Agents row */}
      <div className="grid w-full grid-cols-4 gap-1.5 px-1">
        {ORG_NODES.agents.map((agent) => (
          <AgentChip key={agent.label} label={agent.label} color={agent.color} />
        ))}
      </div>
    </div>
  );
}

// ─── 4. Conversations ────────────────────────────────────────────────────────

const CONVS = [
  {
    channel: "WhatsApp",
    dot: "bg-green-500",
    pill: "bg-green-500/15 text-green-400 border-green-500/30",
    user: "Hi, I'd like a quote for the Pro plan…",
    agent: "Sure! Pro is $49/mo per seat. Want a demo?",
  },
  {
    channel: "Telegram",
    dot: "bg-sky-500",
    pill: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    user: "Hola, busco integrar con mi CRM…",
    agent: "¡Claro! Tenemos conectores nativos para HubSpot y Salesforce.",
  },
  {
    channel: "Slack",
    dot: "bg-purple-500",
    pill: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    user: "@orchester help with onboarding flow",
    agent: "I've found 3 resources for onboarding. Here's the top one…",
  },
] as const;

function ConvsMockup() {
  return (
    <div className="space-y-2">
      {CONVS.map((c, i) => (
        <div key={i} className="rounded-lg bg-zinc-800/50 px-2.5 py-2">
          {/* Channel pill */}
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${c.dot}`} />
            <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${c.pill}`}>
              {c.channel}
            </span>
          </div>
          {/* User bubble */}
          <p className="truncate text-[10px] text-zinc-400">
            <span className="text-zinc-500">User: </span>
            {c.user}
          </p>
          {/* Agent bubble */}
          <p className="mt-0.5 truncate text-[10px] text-violet-300">
            <span className="text-zinc-500">Agent: </span>
            {c.agent}
          </p>
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
