"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { AlertCircle, Workflow, Eye, Bot, Users } from "lucide-react";

const PROBLEMS = [
  {
    key: "confused",
    Icon: AlertCircle,
    color: "text-rose-400 bg-rose-500/10 border-rose-500/20",
  },
  {
    key: "slow",
    Icon: Workflow,
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  },
  {
    key: "blind",
    Icon: Eye,
    color: "text-zinc-400 bg-zinc-700/30 border-zinc-700/50",
  },
] as const;

function SingleAgentMockup() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-8">
      <span className="absolute right-3 top-3 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-rose-300">
        Before
      </span>
      <motion.div
        animate={{ rotate: [0, -2, 2, -1, 0], scale: [1, 1.02, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        className="flex h-20 w-20 items-center justify-center rounded-2xl border border-rose-500/40 bg-zinc-900 shadow-lg shadow-rose-500/20"
      >
        <Bot size={36} className="text-rose-300" />
      </motion.div>
      <div className="mt-2 text-center">
        <p className="text-sm font-semibold text-zinc-200">One agent. Twelve jobs.</p>
        <p className="mt-1 text-xs text-zinc-500">Context overflow. Drift. Hallucination.</p>
      </div>
      {/* "Tasks" floating around it */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
        {["billing", "support", "lead", "search", "report", "+8"].map((t) => (
          <span
            key={t}
            className="rounded-md border border-zinc-700/60 bg-zinc-900/60 px-1.5 py-0.5 text-[10px] text-zinc-500"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function TeamMockup() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 to-cyan-500/5 p-8">
      <span className="absolute right-3 top-3 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
        After
      </span>
      {/* Orchestrator */}
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-violet-500/40 bg-zinc-900 shadow-lg shadow-violet-500/20">
        <Users size={20} className="text-violet-300" />
      </div>
      {/* Connecting lines + specialists */}
      <svg width="200" height="32" viewBox="0 0 200 32" className="-my-1" aria-hidden="true">
        <path
          d="M 100 0 V 16 H 30 V 30"
          stroke="#52525b"
          strokeWidth="1"
          strokeDasharray="2 2"
          fill="none"
        />
        <path
          d="M 100 16 H 100 V 30"
          stroke="#52525b"
          strokeWidth="1"
          strokeDasharray="2 2"
          fill="none"
        />
        <path
          d="M 100 16 H 170 V 30"
          stroke="#52525b"
          strokeWidth="1"
          strokeDasharray="2 2"
          fill="none"
        />
      </svg>
      <div className="flex items-start gap-3">
        {[
          {
            label: "Sales",
            color: "text-cyan-400 border-cyan-500/40 bg-cyan-500/10",
          },
          {
            label: "Support",
            color: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
          },
          {
            label: "Ops",
            color: "text-amber-400 border-amber-500/40 bg-amber-500/10",
          },
        ].map((s) => (
          <div
            key={s.label}
            className={`flex h-8 w-12 items-center justify-center rounded-md border ${s.color} text-[10px] font-medium`}
          >
            {s.label}
          </div>
        ))}
      </div>
      <div className="mt-2 text-center">
        <p className="text-sm font-semibold text-zinc-200">A team. One job each.</p>
        <p className="mt-1 text-xs text-zinc-500">Routed. Parallel. Traceable.</p>
      </div>
    </div>
  );
}

export function ProblemSection() {
  const t = useTranslations("marketing.problem");

  return (
    <section className="border-y border-zinc-800/40 bg-zinc-950/30 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-16 text-center"
        >
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-rose-400">{t("eyebrow")}</p>
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            {t("title1")} <span className="text-zinc-500">{t("title2")}</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-zinc-400">
            {t("subtitle")}
          </p>
        </motion.div>

        {/* Comparison */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="grid gap-4 md:grid-cols-2"
        >
          <SingleAgentMockup />
          <TeamMockup />
        </motion.div>

        {/* 3 pain points */}
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PROBLEMS.map(({ key, Icon, color }, i) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: 0.1 + i * 0.07, duration: 0.4 }}
              className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-5"
            >
              <div
                className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border ${color}`}
              >
                <Icon size={16} />
              </div>
              <h3 className="mb-1.5 text-base font-semibold text-zinc-100">
                {t(`points.${key}.title`)}
              </h3>
              <p className="text-sm leading-relaxed text-zinc-500">{t(`points.${key}.desc`)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
