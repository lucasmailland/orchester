"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { type LucideIcon, MessageSquareCode, Workflow } from "lucide-react";

function PatternCard({
  Icon,
  eyebrow,
  title,
  subtitle,
  desc,
  mockup,
  tags,
  accent,
  bg,
}: {
  Icon: LucideIcon;
  eyebrow: string;
  title: string;
  subtitle: string;
  desc: string;
  mockup: React.ReactNode;
  tags: string[];
  accent: string;
  bg: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1] }}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 p-7 transition-all duration-300 hover:border-zinc-700 hover:bg-zinc-900/60 ${bg}`}
    >
      <div className="mb-5 flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${accent}`}>
          <Icon size={18} />
        </div>
        <div>
          <p
            className={`text-[10px] font-medium uppercase tracking-widest ${accent.split(" ")[0]}`}
          >
            {eyebrow}
          </p>
          <h3 className="font-display text-xl font-bold text-zinc-100">{title}</h3>
        </div>
      </div>
      <p className="mb-1.5 text-sm font-medium text-zinc-300">{subtitle}</p>
      <p className="mb-6 text-sm leading-relaxed text-zinc-500">{desc}</p>
      <div className="mb-5 flex-1">{mockup}</div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="rounded-md border border-zinc-700/60 bg-zinc-800/40 px-2 py-0.5 text-[10px] text-zinc-400"
          >
            {t}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

function PromptToolsMockup() {
  return (
    <div className="rounded-lg border border-zinc-800 bg-[#0A0A0C] p-4 font-mono text-[11px] leading-6">
      <div className="mb-2 flex items-center gap-1.5">
        <div className="h-2 w-2 rounded-full bg-red-500/40" />
        <div className="h-2 w-2 rounded-full bg-amber-500/40" />
        <div className="h-2 w-2 rounded-full bg-emerald-500/40" />
        <span className="ml-2 text-[9px] text-zinc-600">agents/support.ts</span>
      </div>
      <pre className="overflow-x-auto text-zinc-400">
        <code>
          <span className="text-violet-400">const</span>{" "}
          <span className="text-cyan-300">support</span> ={" "}
          <span className="text-violet-400">await</span> {"orchester."}
          <span className="text-cyan-300">agent</span>
          {"({"}
          {"\n"}
          {"  persona: "}
          <span className="text-amber-300">{`"You help customers..."`}</span>
          {",\n"}
          {"  model:   "}
          <span className="text-amber-300">{`"claude-sonnet-4-6"`}</span>
          {",\n"}
          {"  tools:   ["}
          <span className="text-amber-300">{`"search_kb"`}</span>
          {", "}
          <span className="text-amber-300">{`"refund"`}</span>
          {"],\n"}
          {"  memory:  "}
          <span className="text-amber-300">{`"semantic"`}</span>
          {",\n"}
          {"});"}
        </code>
      </pre>
    </div>
  );
}

function FlowCanvasMockup() {
  return (
    <div className="relative overflow-hidden rounded-lg border border-zinc-800 bg-[#0A0A0C] p-3">
      {/* Grid background */}
      <svg className="absolute inset-0 h-full w-full opacity-20">
        <defs>
          <pattern id="flowgrid" width="14" height="14" patternUnits="userSpaceOnUse">
            <path d="M 14 0 L 0 0 0 14" fill="none" stroke="#52525b" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#flowgrid)" />
      </svg>

      {/* Canvas */}
      <svg viewBox="0 0 320 170" className="relative h-[170px] w-full" preserveAspectRatio="none">
        <defs>
          <marker id="arr2" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
            <path d="M0,0 L5,2.5 L0,5" fill="#71717a" />
          </marker>
        </defs>
        {/* Edges */}
        <path
          d="M 160 22 Q 160 38 160 50"
          stroke="#52525b"
          strokeWidth="1"
          fill="none"
          markerEnd="url(#arr2)"
        />
        <path
          d="M 140 72 Q 100 90 80 102"
          stroke="#52525b"
          strokeWidth="1"
          fill="none"
          markerEnd="url(#arr2)"
        />
        <path
          d="M 180 72 Q 220 90 240 102"
          stroke="#52525b"
          strokeWidth="1"
          fill="none"
          markerEnd="url(#arr2)"
        />
        <path
          d="M 80 124 Q 120 145 155 153"
          stroke="#52525b"
          strokeWidth="1"
          fill="none"
          markerEnd="url(#arr2)"
        />
        <path
          d="M 240 124 Q 200 145 165 153"
          stroke="#52525b"
          strokeWidth="1"
          fill="none"
          markerEnd="url(#arr2)"
        />

        {/* Trigger */}
        <g>
          <rect
            x="135"
            y="6"
            width="50"
            height="20"
            rx="4"
            fill="#f59e0b22"
            stroke="#f59e0b"
            strokeWidth="1"
          />
          <text
            x="160"
            y="19"
            textAnchor="middle"
            fill="#fef3c7"
            fontSize="9"
            fontFamily="monospace"
          >
            Trigger
          </text>
        </g>
        {/* Classify */}
        <g>
          <rect
            x="125"
            y="50"
            width="70"
            height="22"
            rx="4"
            fill="#8b5cf622"
            stroke="#8b5cf6"
            strokeWidth="1"
          />
          <text
            x="160"
            y="64"
            textAnchor="middle"
            fill="#ede9fe"
            fontSize="9"
            fontFamily="monospace"
          >
            Classify
          </text>
        </g>
        {/* Branch L: Tool */}
        <g>
          <rect
            x="50"
            y="102"
            width="60"
            height="22"
            rx="4"
            fill="#06b6d422"
            stroke="#06b6d4"
            strokeWidth="1"
          />
          <text
            x="80"
            y="116"
            textAnchor="middle"
            fill="#cffafe"
            fontSize="9"
            fontFamily="monospace"
          >
            Search KB
          </text>
        </g>
        {/* Branch R: Tool */}
        <g>
          <rect
            x="210"
            y="102"
            width="60"
            height="22"
            rx="4"
            fill="#6366f122"
            stroke="#6366f1"
            strokeWidth="1"
          />
          <text
            x="240"
            y="116"
            textAnchor="middle"
            fill="#e0e7ff"
            fontSize="9"
            fontFamily="monospace"
          >
            Create Tkt
          </text>
        </g>
        {/* Reply */}
        <g>
          <rect
            x="135"
            y="152"
            width="50"
            height="20"
            rx="4"
            fill="#10b98122"
            stroke="#10b981"
            strokeWidth="1"
          />
          <text
            x="160"
            y="165"
            textAnchor="middle"
            fill="#d1fae5"
            fontSize="9"
            fontFamily="monospace"
          >
            Reply
          </text>
        </g>
      </svg>
    </div>
  );
}

export function TwoPatternsSection() {
  const t = useTranslations("marketing.patterns");

  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center"
        >
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-zinc-500">{t("eyebrow")}</p>
          <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            {t("title1")}{" "}
            <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
              {t("title2")}
            </span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-zinc-400">
            {t("subtitle")}
          </p>
        </motion.div>

        <div className="grid gap-6 md:grid-cols-2">
          <PatternCard
            Icon={MessageSquareCode}
            eyebrow={t("prompt.eyebrow")}
            title={t("prompt.title")}
            subtitle={t("prompt.subtitle")}
            desc={t("prompt.desc")}
            mockup={<PromptToolsMockup />}
            tags={["support", "research", "sales", "Q&A"]}
            accent="text-violet-400 bg-violet-500/10 border-violet-500/30"
            bg=""
          />
          <PatternCard
            Icon={Workflow}
            eyebrow={t("flow.eyebrow")}
            title={t("flow.title")}
            subtitle={t("flow.subtitle")}
            desc={t("flow.desc")}
            mockup={<FlowCanvasMockup />}
            tags={["onboarding", "lead routing", "approval", "ETL"]}
            accent="text-cyan-400 bg-cyan-500/10 border-cyan-500/30"
            bg=""
          />
        </div>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="mt-10 text-center text-sm text-zinc-400"
        >
          {t("mixBoth")} <span className="font-medium text-zinc-200">{t("mixBothBold")}</span>
        </motion.p>
      </div>
    </section>
  );
}
