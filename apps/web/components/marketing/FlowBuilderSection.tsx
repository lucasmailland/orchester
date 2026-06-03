"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { GitBranch, RotateCcw, Repeat, Plug, type LucideIcon } from "lucide-react";

const NODES: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: string;
  status?: "ok" | "pending";
}[] = [
  { id: "trigger", x: 350, y: 20, w: 100, h: 32, label: "Trigger", color: "amber", status: "ok" },
  {
    id: "classify",
    x: 340,
    y: 90,
    w: 120,
    h: 36,
    label: "Classify intent",
    color: "violet",
    status: "ok",
  },
  {
    id: "brain",
    x: 180,
    y: 170,
    w: 110,
    h: 36,
    label: "Brain · recall",
    color: "cyan",
    status: "ok",
  },
  {
    id: "search",
    x: 520,
    y: 170,
    w: 110,
    h: 36,
    label: "Tool · search",
    color: "indigo",
    status: "ok",
  },
  {
    id: "branch",
    x: 180,
    y: 250,
    w: 110,
    h: 36,
    label: "Branch · if X",
    color: "fuchsia",
    status: "pending",
  },
  { id: "retry", x: 520, y: 250, w: 110, h: 36, label: "Retry × 3", color: "amber" },
  { id: "refund", x: 100, y: 330, w: 110, h: 36, label: "Action · refund", color: "indigo" },
  { id: "escalate", x: 270, y: 330, w: 130, h: 36, label: "Escalate · human", color: "rose" },
  { id: "reply", x: 130, y: 410, w: 100, h: 32, label: "Reply", color: "emerald", status: "ok" },
];

const EDGES: [string, string][] = [
  ["trigger", "classify"],
  ["classify", "brain"],
  ["classify", "search"],
  ["brain", "branch"],
  ["search", "retry"],
  ["branch", "refund"],
  ["branch", "escalate"],
  ["refund", "reply"],
];

const COLOR_MAP: Record<string, { fill: string; stroke: string; text: string }> = {
  amber: { fill: "#f59e0b22", stroke: "#f59e0b", text: "#fef3c7" },
  violet: { fill: "#8b5cf622", stroke: "#8b5cf6", text: "#ede9fe" },
  cyan: { fill: "#06b6d422", stroke: "#06b6d4", text: "#cffafe" },
  indigo: { fill: "#6366f122", stroke: "#6366f1", text: "#e0e7ff" },
  fuchsia: { fill: "#d946ef22", stroke: "#d946ef", text: "#fae8ff" },
  emerald: { fill: "#10b98122", stroke: "#10b981", text: "#d1fae5" },
  rose: { fill: "#f43f5e22", stroke: "#f43f5e", text: "#ffe4e6" },
};

const FEATURES: { Icon: LucideIcon; key: string }[] = [
  { Icon: GitBranch, key: "branches" },
  { Icon: Repeat, key: "loops" },
  { Icon: RotateCcw, key: "retry" },
  { Icon: Plug, key: "connect" },
];

function FlowCanvasMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 shadow-2xl shadow-black/40 backdrop-blur-sm">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 border-b border-zinc-800/80 bg-zinc-900/60 px-4 py-3">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/50" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-500/50" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/50" />
        </div>
        <div className="ml-2 flex h-5 flex-1 items-center rounded-md bg-zinc-800/60 px-2">
          <span className="text-[10px] text-zinc-500">
            orchester.app / flows / customer-onboarding
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_180px]">
        {/* Canvas */}
        <div className="relative h-[480px] overflow-hidden">
          {/* Dot-grid background */}
          <svg className="absolute inset-0 h-full w-full opacity-20">
            <defs>
              <pattern id="dotGridFB" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.8" fill="#3f3f46" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dotGridFB)" />
          </svg>

          <svg
            viewBox="0 0 800 480"
            className="relative h-full w-full"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <marker id="arrFB" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6" fill="#71717a" />
              </marker>
            </defs>

            {/* Edges */}
            {EDGES.map(([a, b], i) => {
              const na = NODES.find((n) => n.id === a)!;
              const nb = NODES.find((n) => n.id === b)!;
              const x1 = na.x + na.w / 2;
              const y1 = na.y + na.h;
              const x2 = nb.x + nb.w / 2;
              const y2 = nb.y;
              const mx = (x1 + x2) / 2;
              return (
                <path
                  key={i}
                  d={`M${x1},${y1} C${mx},${y1 + 16} ${mx},${y2 - 16} ${x2},${y2}`}
                  fill="none"
                  stroke="#52525b"
                  strokeWidth="1.2"
                  strokeDasharray="4 3"
                  markerEnd="url(#arrFB)"
                />
              );
            })}

            {/* Nodes */}
            {NODES.map((n) => {
              const c = COLOR_MAP[n.color]!;
              return (
                <g key={n.id}>
                  <rect
                    x={n.x}
                    y={n.y}
                    width={n.w}
                    height={n.h}
                    rx={6}
                    fill={c.fill}
                    stroke={c.stroke}
                    strokeWidth="1.2"
                  />
                  <text
                    x={n.x + n.w / 2}
                    y={n.y + n.h / 2 + 4}
                    textAnchor="middle"
                    fill={c.text}
                    fontSize="11"
                    fontFamily="ui-monospace, monospace"
                  >
                    {n.label}
                  </text>
                  {n.status === "ok" && (
                    <circle cx={n.x + n.w - 6} cy={n.y + 6} r={3} fill="#10b981" />
                  )}
                  {n.status === "pending" && (
                    <circle cx={n.x + n.w - 6} cy={n.y + 6} r={3} fill="#f59e0b" />
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Run history side panel */}
        <div className="border-l border-zinc-800/80 bg-zinc-900/30 p-3">
          <p className="mb-3 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
            Run history
          </p>
          <div className="space-y-1.5">
            {[
              { id: "3041", ms: "240ms", status: "ok" },
              { id: "3040", ms: "318ms", status: "ok" },
              { id: "3039", ms: "1.2s", status: "retried" },
              { id: "3038", ms: "187ms", status: "ok" },
              { id: "3037", ms: "412ms", status: "ok" },
            ].map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 rounded-md border border-zinc-800/60 bg-zinc-900/50 px-2 py-1.5"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    r.status === "ok" ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                />
                <span className="font-mono text-[10px] text-zinc-300">#{r.id}</span>
                <span className="ml-auto font-mono text-[10px] text-zinc-500">{r.ms}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FlowBuilderSection() {
  const t = useTranslations("marketing.flowBuilder");

  return (
    <section className="relative overflow-hidden py-28">
      {/* Ambient cyan glow */}
      <div className="pointer-events-none absolute right-0 top-1/3 h-[500px] w-[500px] rounded-full bg-cyan-500/[0.04] blur-[140px]" />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* Top — centered text */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-12 text-center"
        >
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-cyan-400">{t("eyebrow")}</p>
          <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            {t("title")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-zinc-400">
            {t("subtitle")}
          </p>
        </motion.div>

        {/* Center — large canvas mockup */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <FlowCanvasMockup />
        </motion.div>

        {/* Below — 4 feature cards */}
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ Icon, key }, i) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 + i * 0.06, duration: 0.4 }}
              className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-5"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                <Icon size={16} />
              </div>
              <h3 className="mb-1 font-display text-sm font-semibold text-zinc-100">
                {t(`feats.${key}.title`)}
              </h3>
              <p className="text-sm leading-relaxed text-zinc-500">{t(`feats.${key}.desc`)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
